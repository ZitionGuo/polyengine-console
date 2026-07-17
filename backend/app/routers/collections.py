from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from ..models import (
    CollectionCreateRequest,
    CollectionUpdateRequest,
    IndexCreateRequest,
    PointsDeleteRequest,
    PointsPayloadClearRequest,
    PointsPayloadOverwriteRequest,
    PointsQueryRequest,
    PointsRetrieveRequest,
    PointsScrollRequest,
    PointsUpsertRequest,
)
from ..qdrant import QdrantClient, get_qdrant_client

router = APIRouter(prefix="/collections", tags=["collections"])


def _collection_path(collection_name: str, suffix: str = "") -> str:
    return f"/collections/{quote(collection_name, safe='')}{suffix}"


@router.get("")
async def list_collections(client: QdrantClient = Depends(get_qdrant_client)):
    return await client.request("GET", "/collections")


@router.get("/{collection_name}")
async def get_collection(
    collection_name: str,
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request("GET", _collection_path(collection_name))


@router.put("/{collection_name}")
async def create_collection(
    collection_name: str,
    payload: CollectionCreateRequest,
    client: QdrantClient = Depends(get_qdrant_client),
) -> dict[str, Any]:
    collection_result = await client.request(
        "PUT",
        _collection_path(collection_name),
        json=payload.config,
    )

    index_results: list[dict[str, Any]] = []
    index_errors: list[dict[str, Any]] = []
    for index in payload.indexes:
        try:
            result = await _create_index(collection_name, index, client)
            index_results.append({"field_name": index.field_name, "result": result})
        except Exception as exc:  # noqa: BLE001 - preserve created collection and report index failure
            detail = getattr(exc, "detail", str(exc))
            status_code = getattr(exc, "status_code", None)
            index_errors.append(
                {
                    "field_name": index.field_name,
                    "field_schema": index.field_schema,
                    "status_code": status_code,
                    "detail": detail,
                }
            )

    return {
        "collection": collection_result,
        "indexes": index_results,
        "index_errors": index_errors,
    }


@router.delete("/{collection_name}")
async def delete_collection(
    collection_name: str,
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request("DELETE", _collection_path(collection_name))


@router.patch("/{collection_name}")
async def update_collection(
    collection_name: str,
    payload: CollectionUpdateRequest,
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request(
        "PATCH",
        _collection_path(collection_name),
        json=payload.model_dump(exclude_none=True),
    )


@router.get("/{collection_name}/snapshots")
async def list_collection_snapshots(
    collection_name: str,
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request(
        "GET",
        _collection_path(collection_name, "/snapshots"),
    )


@router.post("/{collection_name}/snapshots")
async def create_collection_snapshot(
    collection_name: str,
    wait: bool = Query(default=True),
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request(
        "POST",
        _collection_path(collection_name, "/snapshots"),
        params={"wait": wait},
    )


@router.get("/{collection_name}/snapshots/{snapshot_name}")
async def download_collection_snapshot(
    collection_name: str,
    snapshot_name: str,
    client: QdrantClient = Depends(get_qdrant_client),
):
    snapshot = await client.stream(
        "GET",
        _collection_path(
            collection_name,
            f"/snapshots/{quote(snapshot_name, safe='')}",
        ),
    )
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


@router.delete("/{collection_name}/snapshots/{snapshot_name}")
async def delete_collection_snapshot(
    collection_name: str,
    snapshot_name: str,
    wait: bool = Query(default=True),
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request(
        "DELETE",
        _collection_path(
            collection_name,
            f"/snapshots/{quote(snapshot_name, safe='')}",
        ),
        params={"wait": wait},
    )


@router.get("/{collection_name}/optimizations")
async def get_collection_optimizations(
    collection_name: str,
    completed_limit: int = Query(default=8, ge=0, le=100),
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request(
        "GET",
        _collection_path(collection_name, "/optimizations"),
        params={
            "with": "queued,completed,idle_segments",
            "completed_limit": completed_limit,
        },
    )


@router.put("/{collection_name}/indexes")
async def create_index(
    collection_name: str,
    payload: IndexCreateRequest,
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await _create_index(collection_name, payload, client)


@router.delete("/{collection_name}/indexes/{field_name}")
async def delete_index(
    collection_name: str,
    field_name: str,
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request(
        "DELETE",
        _collection_path(collection_name, f"/index/{quote(field_name, safe='')}"),
    )


@router.post("/{collection_name}/points/scroll")
async def scroll_points(
    collection_name: str,
    payload: PointsScrollRequest,
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request(
        "POST",
        _collection_path(collection_name, "/points/scroll"),
        json=payload.model_dump(exclude_none=True),
    )


@router.post("/{collection_name}/points/query")
async def query_points(
    collection_name: str,
    payload: PointsQueryRequest,
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request(
        "POST",
        _collection_path(collection_name, "/points/query"),
        json=payload.model_dump(exclude_none=True),
    )


@router.post("/{collection_name}/points/retrieve")
async def retrieve_points(
    collection_name: str,
    payload: PointsRetrieveRequest,
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request(
        "POST",
        _collection_path(collection_name, "/points"),
        json=payload.model_dump(exclude_none=True),
    )


@router.put("/{collection_name}/points")
async def upsert_points(
    collection_name: str,
    payload: PointsUpsertRequest,
    wait: bool | None = Query(default=True),
    ordering: str | None = Query(default=None, pattern="^(weak|medium|strong)$"),
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request(
        "PUT",
        _collection_path(collection_name, "/points"),
        params={
            key: value
            for key, value in {"wait": wait, "ordering": ordering}.items()
            if value is not None
        },
        json=payload.model_dump(exclude_none=True),
    )


@router.put("/{collection_name}/points/payload")
async def overwrite_point_payload(
    collection_name: str,
    payload: PointsPayloadOverwriteRequest,
    wait: bool | None = Query(default=True),
    ordering: str | None = Query(default=None, pattern="^(weak|medium|strong)$"),
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request(
        "PUT",
        _collection_path(collection_name, "/points/payload"),
        params={
            key: value
            for key, value in {"wait": wait, "ordering": ordering}.items()
            if value is not None
        },
        json=payload.model_dump(),
    )


@router.post("/{collection_name}/points/payload/clear")
async def clear_point_payload(
    collection_name: str,
    payload: PointsPayloadClearRequest,
    wait: bool | None = Query(default=True),
    ordering: str | None = Query(default=None, pattern="^(weak|medium|strong)$"),
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request(
        "POST",
        _collection_path(collection_name, "/points/payload/clear"),
        params={
            key: value
            for key, value in {"wait": wait, "ordering": ordering}.items()
            if value is not None
        },
        json=payload.model_dump(),
    )


@router.post("/{collection_name}/points/delete")
async def delete_points(
    collection_name: str,
    payload: PointsDeleteRequest,
    wait: bool | None = Query(default=True),
    ordering: str | None = Query(default=None, pattern="^(weak|medium|strong)$"),
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request(
        "POST",
        _collection_path(collection_name, "/points/delete"),
        params={
            key: value
            for key, value in {"wait": wait, "ordering": ordering}.items()
            if value is not None
        },
        json=payload.model_dump(exclude_none=True),
    )


async def _create_index(
    collection_name: str,
    payload: IndexCreateRequest,
    client: QdrantClient,
):
    return await client.request(
        "PUT",
        _collection_path(collection_name, "/index"),
        json={
            "field_name": payload.field_name,
            "field_schema": payload.field_schema,
        },
    )
