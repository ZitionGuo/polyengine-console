from collections.abc import AsyncIterator
from dataclasses import dataclass
from time import perf_counter
from typing import Any
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException, Request

from .config import Settings


def normalize_qdrant_path(path: str) -> str:
    parts = urlsplit(path)
    if parts.scheme or parts.netloc:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Only relative Qdrant API paths are allowed.",
                "upstream_status": None,
                "upstream_body": None,
            },
        )
    if not path.startswith("/"):
        return f"/{path}"
    return path


@dataclass
class QdrantStream:
    body: AsyncIterator[bytes]
    content_type: str
    content_length: str | None = None


@dataclass
class QdrantHttpResponse:
    body: Any
    status_code: int
    headers: dict[str, str]
    duration_ms: float


class QdrantClient:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self._base_url = str(settings.qdrant_url).rstrip("/")
        self._api_key = settings.qdrant_api_key
        self._transport = transport
        self._request_client: httpx.AsyncClient | None = None
        self._stream_client: httpx.AsyncClient | None = None

    def _headers(self) -> dict[str, str]:
        return {"api-key": self._api_key} if self._api_key else {}

    def _get_request_client(self) -> httpx.AsyncClient:
        if self._request_client is None or self._request_client.is_closed:
            self._request_client = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=30,
                transport=self._transport,
                trust_env=False,
            )
        return self._request_client

    def _get_stream_client(self) -> httpx.AsyncClient:
        if self._stream_client is None or self._stream_client.is_closed:
            self._stream_client = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=httpx.Timeout(30, read=None),
                transport=self._transport,
                trust_env=False,
            )
        return self._stream_client

    async def aclose(self) -> None:
        clients = [self._request_client, self._stream_client]
        self._request_client = None
        self._stream_client = None
        for client in clients:
            if client is not None and not client.is_closed:
                await client.aclose()

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any | None = None,
    ) -> Any:
        response = await self.request_with_metadata(
            method,
            path,
            params=params,
            json=json,
        )
        return response.body

    async def request_with_metadata(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any | None = None,
    ) -> QdrantHttpResponse:
        started_at = perf_counter()
        try:
            response = await self._get_request_client().request(
                method,
                normalize_qdrant_path(path),
                params=params,
                json=json,
                headers=self._headers(),
            )
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=503,
                detail={
                    "message": "Unable to reach Qdrant.",
                    "upstream_status": None,
                    "upstream_body": str(exc),
                },
            ) from exc

        duration_ms = (perf_counter() - started_at) * 1000
        body = self._decode_body(response)
        if response.status_code >= 400:
            raise HTTPException(
                status_code=response.status_code,
                detail={
                    "message": "Qdrant returned an error.",
                    "upstream_status": response.status_code,
                    "upstream_body": body,
                },
            )
        return QdrantHttpResponse(
            body=body,
            status_code=response.status_code,
            headers=dict(response.headers),
            duration_ms=duration_ms,
        )

    async def stream(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> QdrantStream:
        normalized_path = normalize_qdrant_path(path)
        client = self._get_stream_client()
        try:
            request = client.build_request(
                method,
                normalized_path,
                params=params,
                headers=self._headers(),
            )
            response = await client.send(request, stream=True)
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=503,
                detail={
                    "message": "Unable to reach Qdrant.",
                    "upstream_status": None,
                    "upstream_body": str(exc),
                },
            ) from exc

        if response.status_code >= 400:
            await response.aread()
            body = self._decode_body(response)
            await response.aclose()
            raise HTTPException(
                status_code=response.status_code,
                detail={
                    "message": "Qdrant returned an error.",
                    "upstream_status": response.status_code,
                    "upstream_body": body,
                },
            )

        async def body_iterator() -> AsyncIterator[bytes]:
            try:
                async for chunk in response.aiter_bytes():
                    yield chunk
            finally:
                await response.aclose()

        return QdrantStream(
            body=body_iterator(),
            content_type=response.headers.get("content-type", "application/octet-stream"),
            content_length=response.headers.get("content-length"),
        )

    @staticmethod
    def _decode_body(response: httpx.Response) -> Any:
        if not response.content:
            return None
        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            return response.json()
        try:
            return response.json()
        except ValueError:
            return response.text


def get_qdrant_client(request: Request) -> QdrantClient:
    return request.app.state.qdrant_client
