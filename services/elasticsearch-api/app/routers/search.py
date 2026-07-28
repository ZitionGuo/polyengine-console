import asyncio
from time import perf_counter
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException

from ..elasticsearch import (
    ElasticsearchClient,
    ElasticsearchHttpResponse,
    get_elasticsearch_client,
)
from ..embeddings import EmbeddingService, get_embedding_service
from ..models import SearchRequest, VectorTarget
from ..schema import parse_index_mapping


router = APIRouter(prefix="/search", tags=["search"])
LEXICAL_SOURCE = "BM25"


def _elapsed_ms(started: float) -> float:
    return (perf_counter() - started) * 1000


def _filter_query(filters: list[dict[str, Any]]) -> dict[str, Any] | None:
    return {"bool": {"filter": filters}} if filters else None


def _source_option(payload: SearchRequest) -> bool | list[str]:
    return payload.source_fields if payload.source_fields else True


def _source_window(payload: SearchRequest) -> int:
    needs_fusion_window = payload.mode == "hybrid" or payload.result_mode == "fuse"
    return payload.rank_window_size if needs_fusion_window else payload.top_k


def _lexical_query(payload: SearchRequest) -> dict[str, Any]:
    fields = [
        f"{item.field}^{item.boost:g}" if item.boost != 1 else item.field
        for item in payload.lexical_fields
    ]
    query: dict[str, Any] = {
        "multi_match": {
            "query": payload.text,
            "fields": fields,
            "type": "best_fields",
        }
    }
    filter_query = _filter_query(payload.filters)
    if filter_query:
        return {"bool": {"must": [query], "filter": payload.filters}}
    return query


def _knn_query(
    payload: SearchRequest,
    target: VectorTarget,
    field: dict[str, Any],
    local_vector: list[float] | None,
) -> dict[str, Any]:
    window = _source_window(payload)
    knn: dict[str, Any] = {
        "field": target.field,
        "k": window,
        "num_candidates": max(
            target.num_candidates or payload.num_candidates,
            window,
        ),
    }
    if target.provider == "local":
        if local_vector is None:
            raise HTTPException(status_code=500, detail={"message": "Local embedding was not prepared."})
        knn["query_vector"] = local_vector
    else:
        builder: dict[str, Any] = {"model_text": payload.text}
        if target.provider == "inference":
            builder["model_id"] = target.inference_id
        knn["query_vector_builder"] = {"text_embedding": builder}
    if target.min_similarity is not None:
        knn["similarity"] = target.min_similarity
    filter_query = _filter_query(payload.filters)
    if filter_query:
        knn["filter"] = filter_query
    return {"knn": knn}


def _validate_fields(
    payload: SearchRequest,
    schema: dict[str, Any],
    embeddings: EmbeddingService,
) -> dict[str, dict[str, Any]]:
    all_fields = {field["name"]: field for field in schema["fields"]}
    vector_fields = {field["name"]: field for field in schema["vector_fields"]}
    missing = sorted(
        {
            *[target.field for target in payload.vector_targets],
            *[item.field for item in payload.lexical_fields],
            *[field for field in payload.source_fields if field != "*"],
        }
        - set(all_fields)
    )
    if missing:
        raise HTTPException(
            status_code=422,
            detail={"message": f"Unknown mapping fields: {', '.join(missing)}."},
        )
    for target in payload.vector_targets:
        field = vector_fields.get(target.field)
        if field is None:
            raise HTTPException(
                status_code=422,
                detail={"message": f"Field '{target.field}' is not a searchable vector field."},
            )
        if not field["compatible"]:
            raise HTTPException(
                status_code=422,
                detail={"message": f"Field '{target.field}' is unavailable: {field['reason']}"},
            )
        if field["type"] == "semantic_text" and target.provider != "field_native":
            raise HTTPException(
                status_code=422,
                detail={"message": f"semantic_text field '{target.field}' must use field-native inference."},
            )
        if field["type"] == "dense_vector" and target.provider == "field_native":
            raise HTTPException(
                status_code=422,
                detail={"message": f"dense_vector field '{target.field}' needs a local or inference provider."},
            )
        if target.provider == "local" and field.get("dimension") != embeddings.dimension:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": (
                        f"Field '{target.field}' has {field.get('dimension')} dimensions; "
                        f"the local model produces {embeddings.dimension}."
                    )
                },
            )
    return vector_fields


def _request_body(payload: SearchRequest, query: dict[str, Any]) -> dict[str, Any]:
    body: dict[str, Any] = {
        "size": _source_window(payload),
        "query": query,
        "_source": _source_option(payload),
        "timeout": f"{payload.timeout_ms}ms",
        "track_total_hits": True,
    }
    if payload.lexical_fields:
        body["highlight"] = {
            "fields": {item.field: {} for item in payload.lexical_fields},
            "fragment_size": 180,
            "number_of_fragments": 2,
        }
    return body


async def _execute(
    client: ElasticsearchClient,
    index: str,
    body: dict[str, Any],
    timeout_ms: int,
) -> ElasticsearchHttpResponse:
    return await client.request_with_metadata(
        "POST",
        f"/{quote(index, safe='')}/_search",
        json_body=body,
        timeout_seconds=(timeout_ms / 1000) + 1,
    )


def _field_result(
    source: str,
    upstream: ElasticsearchHttpResponse | BaseException,
    body: dict[str, Any],
) -> dict[str, Any]:
    if isinstance(upstream, BaseException):
        detail = upstream.detail if isinstance(upstream, HTTPException) else {"message": str(upstream)}
        return {
            "source": source,
            "status": "error",
            "request": body,
            "error": detail,
            "hits": [],
        }
    response = upstream.body if isinstance(upstream.body, dict) else {}
    hits = response.get("hits", {}).get("hits", [])
    return {
        "source": source,
        "status": "ok",
        "request": body,
        "request_ms": round(upstream.duration_ms, 3),
        "took": response.get("took"),
        "timed_out": response.get("timed_out"),
        "shards": response.get("_shards"),
        "total": response.get("hits", {}).get("total"),
        "hits": hits if isinstance(hits, list) else [],
    }


def _document_key(hit: dict[str, Any], position: int) -> str:
    index = hit.get("_index")
    document_id = hit.get("_id")
    if index is not None and document_id is not None:
        return f"{index}:{document_id}"
    return f"position:{position}"


def _weighted_rrf(
    sources: list[dict[str, Any]],
    weights: dict[str, float],
    *,
    rank_constant: int,
    limit: int,
) -> list[dict[str, Any]]:
    fused: dict[str, dict[str, Any]] = {}
    for source in sources:
        if source.get("status") != "ok":
            continue
        source_name = source["source"]
        weight = weights.get(source_name, 1.0)
        if weight <= 0:
            continue
        for position, hit in enumerate(source.get("hits", [])):
            if not isinstance(hit, dict):
                continue
            rank = position + 1
            contribution = weight / (rank_constant + rank)
            key = _document_key(hit, position)
            entry = fused.setdefault(
                key,
                {
                    "hit": hit,
                    "score": 0.0,
                    "ranks": {},
                    "source_scores": {},
                    "contributions": {},
                },
            )
            entry["score"] += contribution
            entry["ranks"][source_name] = rank
            entry["contributions"][source_name] = round(contribution, 8)
            if isinstance(hit.get("_score"), (int, float)):
                entry["source_scores"][source_name] = hit["_score"]
    ranked = sorted(
        fused.values(),
        key=lambda item: (-item["score"], min(item["ranks"].values())),
    )[:limit]
    return [
        {
            **entry["hit"],
            "_score": round(entry["score"], 8),
            "_fusion": {
                "method": "weighted_rrf",
                "ranks": entry["ranks"],
                "source_scores": entry["source_scores"],
                "contributions": entry["contributions"],
            },
        }
        for entry in ranked
    ]


def _weighted_retriever(retriever: dict[str, Any], weight: float) -> dict[str, Any]:
    if weight == 1:
        return retriever
    return {"retriever": retriever, "weight": weight}


async def _native_rrf(
    payload: SearchRequest,
    client: ElasticsearchClient,
    fields: dict[str, dict[str, Any]],
    local_vector: list[float] | None,
) -> dict[str, Any]:
    retrievers: list[dict[str, Any]] = []
    if payload.mode == "hybrid" and payload.lexical_weight > 0:
        retrievers.append(
            _weighted_retriever(
                {"standard": {"query": _lexical_query(payload)}},
                payload.lexical_weight,
            )
        )
    for target in payload.vector_targets:
        if target.weight <= 0:
            continue
        knn = _knn_query(payload, target, fields[target.field], local_vector)["knn"]
        retrievers.append(_weighted_retriever({"knn": knn}, target.weight))
    if len(retrievers) < 2:
        raise HTTPException(
            status_code=422,
            detail={"message": "Native Elasticsearch RRF requires at least two active retrievers."},
        )
    rrf: dict[str, Any] = {
        "retrievers": retrievers,
        "rank_constant": payload.rank_constant,
        "rank_window_size": payload.rank_window_size,
    }
    if payload.filters:
        rrf["filter"] = payload.filters
    body: dict[str, Any] = {
        "size": payload.top_k,
        "retriever": {"rrf": rrf},
        "_source": _source_option(payload),
        "timeout": f"{payload.timeout_ms}ms",
        "track_total_hits": True,
    }
    if payload.lexical_fields:
        body["highlight"] = {"fields": {item.field: {} for item in payload.lexical_fields}}
    upstream = await _execute(client, payload.index, body, payload.timeout_ms)
    response = upstream.body if isinstance(upstream.body, dict) else {}
    return {
        "index": payload.index,
        "mode": payload.mode,
        "result_mode": payload.result_mode,
        "fusion_backend": "elasticsearch",
        "model": None if local_vector is None else "local",
        "dimension": len(local_vector) if local_vector is not None else None,
        "embedding_cache_hit": None,
        "hits": response.get("hits", {}).get("hits", []),
        "result_sets": [],
        "source_results": [],
        "generated_requests": [{"source": "native_rrf", "body": body}],
        "timings": {
            "embedding_ms": 0.0,
            "elasticsearch_ms": round(upstream.duration_ms, 3),
            "fusion_ms": 0.0,
            "total_ms": round(upstream.duration_ms, 3),
        },
        "elasticsearch": {
            "took": response.get("took"),
            "timed_out": response.get("timed_out"),
            "shards": response.get("_shards"),
            "total": response.get("hits", {}).get("total"),
        },
    }


@router.post("")
async def search(
    payload: SearchRequest,
    client: ElasticsearchClient = Depends(get_elasticsearch_client),
    embeddings: EmbeddingService = Depends(get_embedding_service),
):
    started = perf_counter()
    mapping = await client.request("GET", f"/{quote(payload.index, safe='')}/_mapping")
    schema = parse_index_mapping(payload.index, mapping, model_dimension=embeddings.dimension)
    fields = _validate_fields(payload, schema, embeddings)

    local_vector: list[float] | None = None
    embedding_ms = 0.0
    cache_hit: bool | None = None
    if any(target.provider == "local" for target in payload.vector_targets):
        local_vector, embedding_ms, cache_hit = await embeddings.encode_query(payload.text)

    if payload.fusion_backend == "elasticsearch":
        result = await _native_rrf(payload, client, fields, local_vector)
        result["model"] = embeddings.model_name if local_vector is not None else None
        result["embedding_cache_hit"] = cache_hit
        result["timings"]["embedding_ms"] = round(embedding_ms, 3)
        result["timings"]["total_ms"] = round(_elapsed_ms(started), 3)
        return result

    vector_bodies = [
        _request_body(payload, _knn_query(payload, target, fields[target.field], local_vector))
        for target in payload.vector_targets
    ]
    lexical_body = (
        _request_body(payload, _lexical_query(payload))
        if payload.mode == "hybrid"
        else None
    )
    calls = [
        _execute(client, payload.index, body, payload.timeout_ms)
        for body in vector_bodies
    ]
    if lexical_body is not None:
        calls.append(_execute(client, payload.index, lexical_body, payload.timeout_ms))
    upstream_results = await asyncio.gather(*calls, return_exceptions=True)
    source_results = [
        _field_result(target.field, upstream, body)
        for target, upstream, body in zip(
            payload.vector_targets,
            upstream_results[: len(vector_bodies)],
            vector_bodies,
        )
    ]
    lexical_result: dict[str, Any] | None = None
    if lexical_body is not None:
        lexical_result = _field_result(LEXICAL_SOURCE, upstream_results[-1], lexical_body)
        source_results.append(lexical_result)

    fusion_started = perf_counter()
    weights = {target.field: target.weight for target in payload.vector_targets}
    weights[LEXICAL_SOURCE] = payload.lexical_weight
    result_sets: list[dict[str, Any]] = []
    hits: list[dict[str, Any]] = []
    if payload.result_mode == "single":
        vector_result = source_results[0]
        if payload.mode == "hybrid" and lexical_result is not None:
            hits = _weighted_rrf(
                [vector_result, lexical_result],
                weights,
                rank_constant=payload.rank_constant,
                limit=payload.top_k,
            )
        else:
            hits = vector_result.get("hits", [])[: payload.top_k]
    elif payload.result_mode == "compare":
        for vector_result in source_results[: len(payload.vector_targets)]:
            compare_hits = vector_result.get("hits", [])
            compare_sources = [vector_result]
            if payload.mode == "hybrid" and lexical_result is not None:
                compare_sources.append(lexical_result)
                compare_hits = _weighted_rrf(
                    compare_sources,
                    weights,
                    rank_constant=payload.rank_constant,
                    limit=payload.top_k,
                )
            result_sets.append(
                {
                    "label": vector_result["source"],
                    "status": vector_result["status"],
                    "hits": compare_hits[: payload.top_k],
                    "sources": [source["source"] for source in compare_sources],
                    "error": vector_result.get("error"),
                }
            )
    else:
        hits = _weighted_rrf(
            source_results,
            weights,
            rank_constant=payload.rank_constant,
            limit=payload.top_k,
        )
    fusion_ms = _elapsed_ms(fusion_started)

    successful = [result for result in source_results if result["status"] == "ok"]
    es_ms = max((float(result.get("request_ms", 0)) for result in successful), default=0.0)
    return {
        "index": payload.index,
        "mode": payload.mode,
        "result_mode": payload.result_mode,
        "fusion_backend": "application",
        "model": embeddings.model_name if local_vector is not None else None,
        "dimension": len(local_vector) if local_vector is not None else None,
        "embedding_cache_hit": cache_hit,
        "hits": hits,
        "result_sets": result_sets,
        "source_results": source_results,
        "generated_requests": [
            {"source": result["source"], "body": result["request"]}
            for result in source_results
        ],
        "timings": {
            "embedding_ms": round(embedding_ms, 3),
            "elasticsearch_ms": round(es_ms, 3),
            "fusion_ms": round(fusion_ms, 3),
            "total_ms": round(_elapsed_ms(started), 3),
        },
    }
