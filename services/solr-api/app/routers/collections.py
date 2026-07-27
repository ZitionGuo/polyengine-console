import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..embeddings import EmbeddingService, get_embedding_service
from ..solr import SolrClient, get_solr_client


router = APIRouter(prefix="/collections", tags=["collections"])


def _compatibility(field: dict[str, Any], dimension: int) -> tuple[bool, str | None]:
    if field.get("dimension") != dimension:
        return False, f"Expected {dimension} dimensions."
    if field.get("vector_encoding") != "FLOAT32":
        return False, "Only FLOAT32 fields are supported."
    return True, None


async def _summary(name: str, solr: SolrClient, dimension: int) -> dict[str, Any]:
    try:
        schema, count = await asyncio.gather(solr.collection_schema(name), solr.document_count(name))
        vector_fields = []
        for field in schema["vector_fields"]:
            compatible, reason = _compatibility(field, dimension)
            vector_fields.append({**field, "compatible": compatible, "reason": reason})
        return {
            "name": name,
            "document_count": count,
            "vector_fields": vector_fields,
            "text_fields": schema["text_fields"],
            "ready": any(field["compatible"] for field in vector_fields),
        }
    except Exception as exc:  # noqa: BLE001 - keep remaining collection rows available
        detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
        return {
            "name": name,
            "document_count": None,
            "vector_fields": [],
            "text_fields": [],
            "ready": False,
            "error": detail,
        }


@router.get("")
async def list_collections(
    solr: SolrClient = Depends(get_solr_client),
    embeddings: EmbeddingService = Depends(get_embedding_service),
):
    names = await solr.list_collection_names()
    semaphore = asyncio.Semaphore(6)

    async def limited(name: str):
        async with semaphore:
            return await _summary(name, solr, embeddings.dimension)

    return {
        "collections": await asyncio.gather(*(limited(name) for name in names)),
        "model_dimension": embeddings.dimension,
    }


@router.get("/{collection_name}/schema")
async def collection_schema(
    collection_name: str,
    solr: SolrClient = Depends(get_solr_client),
    embeddings: EmbeddingService = Depends(get_embedding_service),
):
    names = await solr.list_collection_names()
    if collection_name not in names:
        raise HTTPException(status_code=404, detail={"message": "Collection was not found."})
    schema = await solr.collection_schema(collection_name)
    schema["vector_fields"] = [
        {
            **field,
            "compatible": (compatible := _compatibility(field, embeddings.dimension))[0],
            "reason": compatible[1],
        }
        for field in schema["vector_fields"]
    ]
    return schema
