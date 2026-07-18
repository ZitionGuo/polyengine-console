from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from ..qdrant import QdrantClient, get_qdrant_client

router = APIRouter(prefix="/snapshots", tags=["storage snapshots"])


def _snapshot_path(snapshot_name: str) -> str:
    return f"/snapshots/{quote(snapshot_name, safe='')}"


@router.get("")
async def list_storage_snapshots(
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request("GET", "/snapshots")


@router.post("")
async def create_storage_snapshot(
    wait: bool = Query(default=True),
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request(
        "POST",
        "/snapshots",
        params={"wait": wait},
        timeout=httpx.Timeout(connect=30, read=None, write=30, pool=30),
    )


@router.get("/{snapshot_name}")
async def download_storage_snapshot(
    snapshot_name: str,
    client: QdrantClient = Depends(get_qdrant_client),
):
    snapshot = await client.stream("GET", _snapshot_path(snapshot_name))
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(snapshot_name, safe='')}",
    }
    if snapshot.content_length:
        headers["Content-Length"] = snapshot.content_length
    return StreamingResponse(
        snapshot.body,
        media_type=snapshot.content_type,
        headers=headers,
    )


@router.delete("/{snapshot_name}")
async def delete_storage_snapshot(
    snapshot_name: str,
    wait: bool = Query(default=True),
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request(
        "DELETE",
        _snapshot_path(snapshot_name),
        params={"wait": wait},
    )
