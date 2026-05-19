from fastapi import APIRouter, Depends

from ..qdrant import QdrantClient, get_qdrant_client
from .collections import _collection_path

router = APIRouter(tags=["cluster"])


@router.get("/cluster")
async def get_cluster(client: QdrantClient = Depends(get_qdrant_client)):
    return await client.request("GET", "/cluster")


@router.get("/cluster/telemetry")
async def get_cluster_telemetry(client: QdrantClient = Depends(get_qdrant_client)):
    return await client.request("GET", "/telemetry")


@router.get("/collections/{collection_name}/cluster")
async def get_collection_cluster(
    collection_name: str,
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request("GET", _collection_path(collection_name, "/cluster"))
