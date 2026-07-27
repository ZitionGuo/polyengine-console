from fastapi import APIRouter, Depends

from ..models import RestProxyRequest
from ..qdrant import QdrantClient, get_qdrant_client, normalize_qdrant_path

router = APIRouter(tags=["rest"])

_SAFE_RESPONSE_HEADERS = {
    "content-length",
    "content-type",
    "date",
    "server",
    "transfer-encoding",
    "x-request-id",
}


@router.post("/rest")
async def proxy_rest(
    payload: RestProxyRequest,
    client: QdrantClient = Depends(get_qdrant_client),
):
    path = normalize_qdrant_path(payload.path)
    response = await client.request_with_metadata(
        payload.method,
        path,
        params=payload.query or None,
        json=payload.body if payload.method not in {"GET", "HEAD"} else None,
    )
    return {
        "status_code": response.status_code,
        "headers": {
            key: value
            for key, value in response.headers.items()
            if key.lower() in _SAFE_RESPONSE_HEADERS
        },
        "duration_ms": round(response.duration_ms, 3),
        "body": response.body,
    }
