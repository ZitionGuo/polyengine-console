import asyncio
from typing import Any, Literal
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from ..models import (
    CollectionCreateRequest,
    CollectionUpdateRequest,
    IndexCreateRequest,
    PointsDeleteRequest,
    PointsCountRequest,
    PointsFacetRequest,
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


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _collection_names(response: Any) -> list[str]:
    result = _as_dict(_as_dict(response).get("result"))
    collections = result.get("collections")
    if not isinstance(collections, list):
        return []
    return [
        name
        for item in collections
        if isinstance(item, dict)
        and isinstance((name := item.get("name")), str)
        and name
    ]


def _collection_overview(name: str, response: Any) -> dict[str, Any]:
    result = _as_dict(_as_dict(response).get("result", response))
    config = _as_dict(result.get("config"))
    params = _as_dict(config.get("params"))
    vectors = _as_dict(params.get("vectors"))
    sparse_vectors = _as_dict(params.get("sparse_vectors"))
    update_queue = _as_dict(result.get("update_queue"))
    dense_vector_count = 1 if "size" in vectors else len(vectors)

    return {
        "name": name,
        "status": result.get("status"),
        "optimizer_status": result.get("optimizer_status"),
        "points_count": result.get("points_count"),
        "vectors_count": result.get("vectors_count"),
        "indexed_vectors_count": result.get("indexed_vectors_count"),
        "segments_count": result.get("segments_count"),
        "dense_vector_count": dense_vector_count,
        "sparse_vector_count": len(sparse_vectors),
        "update_queue_length": update_queue.get("length"),
    }


def _collection_error(name: str, exc: Exception) -> dict[str, Any]:
    if isinstance(exc, HTTPException):
        return {
            "name": name,
            "status_code": exc.status_code,
            "detail": exc.detail,
        }
    return {
        "name": name,
        "status_code": None,
        "detail": str(exc),
    }


async def _load_collection_overview(
    name: str,
    client: QdrantClient,
    semaphore: asyncio.Semaphore,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    try:
        async with semaphore:
            response = await client.request("GET", _collection_path(name))
        return _collection_overview(name, response), None
    except Exception as exc:  # noqa: BLE001 - keep the remaining collection rows available
        error = _collection_error(name, exc)
        return {
            "name": name,
            "status": "unavailable",
            "error": error,
        }, error


@router.get("")
async def list_collections(
    include_details: bool = Query(default=False),
    client: QdrantClient = Depends(get_qdrant_client),
):
    response = await client.request("GET", "/collections")
    if not include_details:
        return response

    names = _collection_names(response)
    semaphore = asyncio.Semaphore(8)
    overview_results = await asyncio.gather(
        *(_load_collection_overview(name, client, semaphore) for name in names)
    )
    collections = [overview for overview, _ in overview_results]
    errors = [error for _, error in overview_results if error is not None]
    return {
        "result": {
            "collections": collections,
            "errors": errors,
        },
        "status": "partial" if errors else "ok",
    }


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


@router.post("/{collection_name}/snapshots/upload")
async def upload_collection_snapshot(
    collection_name: str,
    snapshot: UploadFile = File(...),
    wait: bool = Query(default=True),
    priority: Literal["snapshot", "replica", "no_sync"] = Query(default="snapshot"),
    checksum: str | None = Query(default=None, pattern="^[A-Fa-f0-9]{64}$"),
    client: QdrantClient = Depends(get_qdrant_client),
):
    filename = (snapshot.filename or "snapshot.snapshot").replace("\\", "/").rsplit("/", 1)[-1]
    if not filename.lower().endswith(".snapshot"):
        await snapshot.close()
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Snapshot files must use the .snapshot extension.",
                "upstream_status": None,
                "upstream_body": None,
            },
        )

    params: dict[str, Any] = {"wait": wait, "priority": priority}
    if checksum:
        params["checksum"] = checksum.lower()

    try:
        return await client.request(
            "POST",
            _collection_path(collection_name, "/snapshots/upload"),
            params=params,
            files={
                "snapshot": (
                    filename,
                    snapshot.file,
                    snapshot.content_type or "application/octet-stream",
                )
            },
            timeout=httpx.Timeout(connect=30, read=None, write=None, pool=30),
        )
    finally:
        await snapshot.close()


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


@router.post("/{collection_name}/points/count")
async def count_points(
    collection_name: str,
    payload: PointsCountRequest,
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request(
        "POST",
        _collection_path(collection_name, "/points/count"),
        json=payload.model_dump(exclude_none=True),
    )


@router.post("/{collection_name}/points/facet")
async def facet_points(
    collection_name: str,
    payload: PointsFacetRequest,
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request(
        "POST",
        _collection_path(collection_name, "/facet"),
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
