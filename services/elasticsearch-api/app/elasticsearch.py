import json
from dataclasses import dataclass
from time import perf_counter
from typing import Any
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException, Request

from .config import Settings


@dataclass
class ElasticsearchHttpResponse:
    body: Any
    duration_ms: float
    status_code: int


def _upstream_message(body: Any, fallback: str) -> str:
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            reason = error.get("reason")
            if isinstance(reason, str):
                return reason
            root_causes = error.get("root_cause")
            if isinstance(root_causes, list) and root_causes:
                cause = root_causes[0]
                if isinstance(cause, dict) and isinstance(cause.get("reason"), str):
                    return cause["reason"]
        if isinstance(error, str):
            return error
    return fallback


class ElasticsearchClient:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        headers = {"Accept": "application/json"}
        auth: httpx.Auth | None = None
        if settings.elasticsearch_api_key:
            headers["Authorization"] = f"ApiKey {settings.elasticsearch_api_key}"
        elif settings.elasticsearch_username:
            auth = httpx.BasicAuth(
                settings.elasticsearch_username,
                settings.elasticsearch_password or "",
            )
        verify: bool | str = settings.elasticsearch_verify_ssl
        if settings.elasticsearch_ca_cert:
            verify = settings.elasticsearch_ca_cert
        self._client = httpx.AsyncClient(
            base_url=str(settings.elasticsearch_url).rstrip("/"),
            headers=headers,
            auth=auth,
            verify=verify,
            transport=transport,
            timeout=httpx.Timeout(
                connect=settings.elasticsearch_connect_timeout_seconds,
                read=settings.elasticsearch_read_timeout_seconds,
                write=settings.elasticsearch_read_timeout_seconds,
                pool=settings.elasticsearch_connect_timeout_seconds,
            ),
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    @staticmethod
    def validate_path(path: str) -> str:
        parsed = urlsplit(path)
        if parsed.scheme or parsed.netloc or not path.startswith("/"):
            raise HTTPException(status_code=400, detail={"message": "Upstream path must be relative."})
        if path.startswith("//"):
            raise HTTPException(status_code=400, detail={"message": "Protocol-relative paths are forbidden."})
        return path

    async def request_with_metadata(
        self,
        method: str,
        path: str,
        *,
        json_body: Any | None = None,
        params: dict[str, Any] | None = None,
        timeout_seconds: float | None = None,
    ) -> ElasticsearchHttpResponse:
        self.validate_path(path)
        started = perf_counter()
        try:
            response = await self._client.request(
                method,
                path,
                json=json_body,
                params=params,
                timeout=timeout_seconds,
            )
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=504,
                detail={
                    "message": "Elasticsearch request timed out.",
                    "upstream_status": None,
                    "upstream_body": str(exc),
                },
            ) from exc
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=503,
                detail={
                    "message": "Unable to reach Elasticsearch.",
                    "upstream_status": None,
                    "upstream_body": str(exc),
                },
            ) from exc

        duration_ms = (perf_counter() - started) * 1000
        try:
            body: Any = response.json() if response.content else None
        except json.JSONDecodeError:
            body = response.text
        if response.is_error:
            raise HTTPException(
                status_code=response.status_code,
                detail={
                    "message": _upstream_message(body, f"Elasticsearch returned HTTP {response.status_code}."),
                    "upstream_status": response.status_code,
                    "upstream_body": body,
                },
            )
        return ElasticsearchHttpResponse(
            body=body,
            duration_ms=duration_ms,
            status_code=response.status_code,
        )

    async def request(self, method: str, path: str, **kwargs: Any) -> Any:
        return (await self.request_with_metadata(method, path, **kwargs)).body


def get_elasticsearch_client(request: Request) -> ElasticsearchClient:
    return request.app.state.elasticsearch_client
