from fastapi import APIRouter, Depends

from ..qdrant import QdrantClient, get_qdrant_client

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(client: QdrantClient = Depends(get_qdrant_client)):
    return {
        "status": "ok",
        "qdrant": await client.request("GET", "/"),
    }
