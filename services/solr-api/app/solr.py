import asyncio
from copy import deepcopy
from dataclasses import dataclass
from time import monotonic, perf_counter
from typing import Any, Awaitable, Callable
from urllib.parse import quote

import httpx
from fastapi import HTTPException, Request

from .config import Settings


@dataclass
class SolrHttpResponse:
    body: Any
    status_code: int
    duration_ms: float


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


class SolrClient:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.base_url = str(settings.solr_url).rstrip("/")
        self._transport = transport
        self._verify = settings.solr_verify_ssl
        self._connect_timeout = settings.solr_connect_timeout_seconds
        self._read_timeout = settings.solr_read_timeout_seconds
        self._metadata_cache_ttl = settings.solr_metadata_cache_ttl_seconds
        self._auth = (
            httpx.BasicAuth(settings.solr_username, settings.solr_password or "")
            if settings.solr_username
            else None
        )
        self._client: httpx.AsyncClient | None = None
        self._metadata_cache: dict[str, tuple[float, Any]] = {}
        self._metadata_cache_locks: dict[str, asyncio.Lock] = {}

    @property
    def admin_url(self) -> str:
        base = self.base_url
        return f"{base}/#/" if base.endswith("/solr") else f"{base.rsplit('/solr', 1)[0]}/solr/#/"

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                auth=self._auth,
                verify=self._verify,
                timeout=httpx.Timeout(
                    self._read_timeout,
                    connect=self._connect_timeout,
                ),
                transport=self._transport,
                trust_env=False,
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
        self._client = None
        self.invalidate_metadata_cache()

    async def _cached_metadata(
        self,
        key: str,
        loader: Callable[[], Awaitable[Any]],
    ) -> Any:
        if self._metadata_cache_ttl <= 0:
            return await loader()

        cached = self._metadata_cache.get(key)
        if cached is not None and cached[0] > monotonic():
            return deepcopy(cached[1])

        lock = self._metadata_cache_locks.setdefault(key, asyncio.Lock())
        async with lock:
            cached = self._metadata_cache.get(key)
            if cached is not None and cached[0] > monotonic():
                return deepcopy(cached[1])
            value = await loader()
            self._metadata_cache[key] = (
                monotonic() + self._metadata_cache_ttl,
                deepcopy(value),
            )
            return deepcopy(value)

    def invalidate_metadata_cache(self, collection: str | None = None) -> None:
        if collection is None:
            self._metadata_cache.clear()
            self._metadata_cache_locks.clear()
            return
        self._metadata_cache.pop("collections", None)
        self._metadata_cache.pop(f"schema:{collection}", None)
        self._metadata_cache_locks.pop("collections", None)
        self._metadata_cache_locks.pop(f"schema:{collection}", None)

    async def request_with_metadata(
        self,
        method: str,
        path: str,
        *,
        params: Any | None = None,
        json: Any | None = None,
        data: Any | None = None,
        timeout_seconds: float | None = None,
    ) -> SolrHttpResponse:
        started = perf_counter()
        try:
            request_options: dict[str, Any] = {
                "params": params,
                "json": json,
                "data": data,
            }
            if timeout_seconds is not None:
                request_options["timeout"] = timeout_seconds
            response = await self._get_client().request(
                method,
                path if path.startswith("/") else f"/{path}",
                **request_options,
            )
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=504,
                detail={
                    "message": "Solr query timed out.",
                    "upstream_status": None,
                    "upstream_body": str(exc),
                },
            ) from exc
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=503,
                detail={
                    "message": "Unable to reach Solr.",
                    "upstream_status": None,
                    "upstream_body": str(exc),
                },
            ) from exc

        body = self._decode(response)
        if response.status_code >= 400:
            raise HTTPException(
                status_code=response.status_code,
                detail={
                    "message": "Solr returned an error.",
                    "upstream_status": response.status_code,
                    "upstream_body": body,
                },
            )
        return SolrHttpResponse(
            body=body,
            status_code=response.status_code,
            duration_ms=(perf_counter() - started) * 1000,
        )

    async def request(self, method: str, path: str, **kwargs: Any) -> Any:
        return (await self.request_with_metadata(method, path, **kwargs)).body

    async def system_info(self) -> dict[str, Any]:
        return _as_dict(await self.request("GET", "/admin/info/system", params={"wt": "json"}))

    async def list_collection_names(self, *, timeout_seconds: float | None = None) -> list[str]:
        async def load() -> list[str]:
            body = _as_dict(
                await self.request(
                    "GET",
                    "/admin/collections",
                    params={"action": "CLUSTERSTATUS", "wt": "json"},
                    timeout_seconds=timeout_seconds,
                )
            )
            collections = _as_dict(_as_dict(body.get("cluster")).get("collections"))
            return sorted(str(name) for name in collections)

        return await self._cached_metadata("collections", load)

    async def collection_schema(
        self,
        collection: str,
        *,
        timeout_seconds: float | None = None,
    ) -> dict[str, Any]:
        async def load() -> dict[str, Any]:
            encoded = quote(collection, safe="")
            fields_body, types_body, unique_key_body = await asyncio.gather(
                self.request(
                    "GET",
                    f"/{encoded}/schema/fields",
                    params={"wt": "json"},
                    timeout_seconds=timeout_seconds,
                ),
                self.request(
                    "GET",
                    f"/{encoded}/schema/fieldtypes",
                    params={"wt": "json"},
                    timeout_seconds=timeout_seconds,
                ),
                self.request(
                    "GET",
                    f"/{encoded}/schema/uniquekey",
                    params={"wt": "json"},
                    timeout_seconds=timeout_seconds,
                ),
            )
            fields = _as_dict(fields_body).get("fields")
            field_types = _as_dict(types_body).get("fieldTypes")
            fields = fields if isinstance(fields, list) else []
            field_types = field_types if isinstance(field_types, list) else []
            type_map = {
                item.get("name"): item
                for item in field_types
                if isinstance(item, dict) and isinstance(item.get("name"), str)
            }

            normalized_fields: list[dict[str, Any]] = []
            vector_fields: list[dict[str, Any]] = []
            text_fields: list[dict[str, Any]] = []
            for field in fields:
                if not isinstance(field, dict) or not isinstance(field.get("name"), str):
                    continue
                field_type = _as_dict(type_map.get(field.get("type")))
                class_name = str(field_type.get("class", ""))
                normalized = {
                    "name": field["name"],
                    "type": field.get("type"),
                    "class": class_name,
                    "indexed": field.get("indexed", True),
                    "stored": field.get("stored", False),
                    "required": field.get("required", False),
                }
                normalized_fields.append(normalized)
                if class_name.endswith("DenseVectorField"):
                    dimension = field_type.get("vectorDimension")
                    try:
                        dimension = int(dimension)
                    except (TypeError, ValueError):
                        dimension = None
                    vector_fields.append(
                        {
                            **normalized,
                            "dimension": dimension,
                            "similarity_function": field_type.get("similarityFunction", "euclidean"),
                            "vector_encoding": str(field_type.get("vectorEncoding", "FLOAT32")).upper(),
                        }
                    )
                elif "TextField" in class_name or class_name.endswith("StrField"):
                    text_fields.append(normalized)

            return {
                "collection": collection,
                "unique_key": _as_dict(unique_key_body).get("uniqueKey"),
                "fields": normalized_fields,
                "vector_fields": vector_fields,
                "text_fields": text_fields,
            }

        return await self._cached_metadata(f"schema:{collection}", load)

    async def document_count(self, collection: str) -> int:
        body = _as_dict(
            await self.request(
                "GET",
                f"/{quote(collection, safe='')}/select",
                params={"q": "*:*", "rows": 0, "wt": "json"},
            )
        )
        return int(_as_dict(body.get("response")).get("numFound", 0))

    @staticmethod
    def _decode(response: httpx.Response) -> Any:
        if not response.content:
            return None
        try:
            return response.json()
        except ValueError:
            return response.text


def get_solr_client(request: Request) -> SolrClient:
    return request.app.state.solr_client
