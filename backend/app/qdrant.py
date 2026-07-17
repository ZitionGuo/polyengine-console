from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx
from fastapi import Depends, HTTPException

from .config import Settings, get_settings


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


class QdrantClient:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self._base_url = str(settings.qdrant_url).rstrip("/")
        self._api_key = settings.qdrant_api_key
        self._transport = transport

    def _headers(self) -> dict[str, str]:
        return {"api-key": self._api_key} if self._api_key else {}

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any | None = None,
    ) -> Any:
        try:
            async with httpx.AsyncClient(
                base_url=self._base_url,
                timeout=30,
                transport=self._transport,
                trust_env=False,
            ) as client:
                response = await client.request(
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
        return body

    async def stream(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> QdrantStream:
        normalized_path = normalize_qdrant_path(path)
        client = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=httpx.Timeout(30, read=None),
            transport=self._transport,
            trust_env=False,
        )
        try:
            request = client.build_request(
                method,
                normalized_path,
                params=params,
                headers=self._headers(),
            )
            response = await client.send(request, stream=True)
        except httpx.RequestError as exc:
            await client.aclose()
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
            await client.aclose()
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
                await client.aclose()

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


def get_qdrant_client(settings: Settings = Depends(get_settings)) -> QdrantClient:
    return QdrantClient(settings)
