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


class QdrantClient:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self._base_url = str(settings.qdrant_url).rstrip("/")
        self._api_key = settings.qdrant_api_key
        self._transport = transport

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any | None = None,
    ) -> Any:
        headers = {}
        if self._api_key:
            headers["api-key"] = self._api_key

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
                    headers=headers,
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
