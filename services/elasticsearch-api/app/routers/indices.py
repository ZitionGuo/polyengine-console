import asyncio
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException

from ..elasticsearch import ElasticsearchClient, get_elasticsearch_client
from ..embeddings import EmbeddingService, get_embedding_service
from ..schema import parse_index_mapping


router = APIRouter(prefix="/indices", tags=["indices"])


async def _aliases(client: ElasticsearchClient) -> dict[str, list[str]]:
    try:
        body = await client.request("GET", "/_alias")
    except HTTPException as exc:
        if exc.status_code == 404:
            return {}
        raise
    result: dict[str, list[str]] = {}
    for index, definition in body.items():
        aliases = definition.get("aliases", {}) if isinstance(definition, dict) else {}
        result[index] = sorted(aliases) if isinstance(aliases, dict) else []
    return result


async def _index_summary(
    row: dict[str, Any],
    aliases: dict[str, list[str]],
    client: ElasticsearchClient,
    embeddings: EmbeddingService,
) -> dict[str, Any]:
    name = str(row.get("index", ""))
    try:
        mapping = await client.request("GET", f"/{quote(name, safe='')}/_mapping")
        schema = parse_index_mapping(name, mapping, model_dimension=embeddings.dimension)
        vectors = schema["vector_fields"]
        return {
            "name": name,
            "health": row.get("health"),
            "status": row.get("status"),
            "document_count": int(row["docs.count"]) if str(row.get("docs.count", "")).isdigit() else None,
            "store_size": row.get("store.size"),
            "aliases": aliases.get(name, []),
            "vector_fields": vectors,
            "text_fields": schema["text_fields"],
            "ready": any(field["compatible"] for field in vectors),
        }
    except Exception as exc:  # noqa: BLE001 - keep other index rows usable
        detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
        return {
            "name": name,
            "health": row.get("health"),
            "status": row.get("status"),
            "document_count": None,
            "store_size": row.get("store.size"),
            "aliases": aliases.get(name, []),
            "vector_fields": [],
            "text_fields": [],
            "ready": False,
            "error": detail,
        }


@router.get("")
async def list_indices(
    client: ElasticsearchClient = Depends(get_elasticsearch_client),
    embeddings: EmbeddingService = Depends(get_embedding_service),
):
    rows, aliases = await asyncio.gather(
        client.request(
            "GET",
            "/_cat/indices",
            params={
                "format": "json",
                "h": "index,docs.count,health,status,store.size",
                "expand_wildcards": "open",
            },
        ),
        _aliases(client),
    )
    user_rows = [
        row
        for row in rows
        if isinstance(row, dict) and row.get("index") and not str(row["index"]).startswith(".")
    ]
    semaphore = asyncio.Semaphore(6)

    async def limited(row: dict[str, Any]):
        async with semaphore:
            return await _index_summary(row, aliases, client, embeddings)

    return {
        "indices": await asyncio.gather(*(limited(row) for row in user_rows)),
        "model_dimension": embeddings.dimension,
    }


@router.get("/{index_name}/schema")
async def index_schema(
    index_name: str,
    client: ElasticsearchClient = Depends(get_elasticsearch_client),
    embeddings: EmbeddingService = Depends(get_embedding_service),
):
    mapping = await client.request("GET", f"/{quote(index_name, safe='')}/_mapping")
    return parse_index_mapping(index_name, mapping, model_dimension=embeddings.dimension)
