from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends

from ..models import CollectionCreateRequest, IndexCreateRequest
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
