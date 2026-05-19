from fastapi import APIRouter, Depends

from ..models import RestProxyRequest
from ..qdrant import QdrantClient, get_qdrant_client, normalize_qdrant_path

router = APIRouter(tags=["rest"])


@router.post("/rest")
async def proxy_rest(
    payload: RestProxyRequest,
    client: QdrantClient = Depends(get_qdrant_client),
):
    path = normalize_qdrant_path(payload.path)
    return await client.request(
        payload.method,
        path,
        params=payload.query or None,
        json=payload.body if payload.method not in {"GET", "HEAD"} else None,
    )
