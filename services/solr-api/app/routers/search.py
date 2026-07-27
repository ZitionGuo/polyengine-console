import asyncio
import json
from time import perf_counter
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException

from ..embeddings import EmbeddingService, get_embedding_service
from ..models import SearchBaseRequest, SearchCompareRequest, SearchFuseRequest, SearchRequest
from ..schema import require_collection_schema, require_vector_field
from ..solr import SolrClient, SolrHttpResponse, get_solr_client


router = APIRouter(prefix="/search", tags=["search"])
_FUSION_ID_FIELD = "_fusion_id"
_LEXICAL_SOURCE = "BM25"


def _elapsed_ms(started: float) -> float:
    return (perf_counter() - started) * 1000


def _timing_breakdown(
    started: float,
    *,
    schema_ms: float,
    model_load_ms: float,
    embedding_ms: float,
    solr_ms: float,
    cold_start: bool,
    embedding_cache_hit: bool,
    fusion_ms: float = 0.0,
) -> dict[str, Any]:
    total_ms = _elapsed_ms(started)
    measured_ms = schema_ms + model_load_ms + embedding_ms + solr_ms + fusion_ms
    return {
        "schema_ms": round(schema_ms, 3),
        "model_load_ms": round(model_load_ms, 3),
        "embedding_ms": round(embedding_ms, 3),
        "solr_ms": round(solr_ms, 3),
        "fusion_ms": round(fusion_ms, 3),
        "overhead_ms": round(max(0.0, total_ms - measured_ms), 3),
        "total_ms": round(total_ms, 3),
        "cold_start": cold_start,
        "embedding_cache_hit": embedding_cache_hit,
    }


async def _prepare_embedding(
    embeddings: EmbeddingService,
    text: str,
) -> tuple[list[float], float, float, bool, bool]:
    cold_start = embeddings.status()["status"] != "ready"
    load_started = perf_counter()
    await embeddings.load()
    model_load_ms = _elapsed_ms(load_started)
    query_vector, embedding_ms, cache_hit = await embeddings.encode_query(text)
    return query_vector, model_load_ms, embedding_ms, cold_start, cache_hit


def _vector_literal(vector: list[float]) -> str:
    return json.dumps(vector, separators=(",", ":"))


def _vector_query(
    payload: SearchBaseRequest,
    vector_field: str,
    vector: str,
    *,
    top_k: int,
    pre_filter: bool = False,
) -> str:
    filter_param = " preFilter=$knnFilter" if pre_filter else ""
    vector_min_scores = getattr(payload, "vector_min_scores", {})
    min_score = vector_min_scores.get(vector_field, payload.min_score)
    if min_score is not None:
        return (
            f"{{!vectorSimilarity f={vector_field} minReturn={min_score:g}"
            f"{filter_param}}}{vector}"
        )
    return f"{{!knn f={vector_field} topK={top_k}{filter_param}}}{vector}"


def _search_form(
    payload: SearchBaseRequest,
    vector_field: str,
    vector: str,
    *,
    identity_field: str | None = None,
) -> dict[str, Any]:
    fields = list(dict.fromkeys(
        [*payload.return_fields, "score"]
        if payload.return_fields
        else ["*", "score"]
    ))
    if identity_field:
        fields.append(f"{_FUSION_ID_FIELD}:{identity_field}")
    form: dict[str, Any] = {
        "rows": payload.limit,
        "fl": ",".join(fields),
        "timeAllowed": payload.timeout_ms,
        "wt": "json",
        "echoParams": "none",
    }
    if payload.mode == "semantic":
        form["q"] = _vector_query(
            payload,
            vector_field,
            vector,
            top_k=payload.limit,
        )
    else:
        vector_candidates = max(payload.vector_candidates, payload.limit)
        rerank_docs = max(payload.rerank_docs, payload.limit)
        query_fields = " ".join(
            f"{field}^{payload.lexical_boosts.get(field, 1.0):g}"
            for field in payload.lexical_fields
        )
        form.update(
            {
                "q": payload.text,
                "defType": "edismax",
                "qf": query_fields,
                "rq": (
                    "{!rerank reRankQuery=$rqq "
                    f"reRankDocs={rerank_docs} reRankWeight={payload.rerank_weight}}}"
                ),
                "rqq": _vector_query(
                    payload,
                    vector_field,
                    vector,
                    top_k=vector_candidates,
                    pre_filter=bool(payload.filters),
                ),
            }
        )
    if payload.filters:
        form["fq"] = payload.filters
        if payload.mode == "hybrid":
            form["knnFilter"] = payload.filters
    return form


def _lexical_search_form(
    payload: SearchBaseRequest,
    *,
    rows: int,
    identity_field: str | None = None,
) -> dict[str, Any]:
    fields = list(dict.fromkeys(
        [*payload.return_fields, "score"]
        if payload.return_fields
        else ["*", "score"]
    ))
    if identity_field:
        fields.append(f"{_FUSION_ID_FIELD}:{identity_field}")
    query_fields = " ".join(
        f"{field}^{payload.lexical_boosts.get(field, 1.0):g}"
        for field in payload.lexical_fields
    )
    form: dict[str, Any] = {
        "q": payload.text,
        "defType": "edismax",
        "qf": query_fields,
        "rows": rows,
        "fl": ",".join(fields),
        "timeAllowed": payload.timeout_ms,
        "wt": "json",
        "echoParams": "none",
    }
    if payload.filters:
        form["fq"] = payload.filters
    return form


async def _request_search(
    solr: SolrClient,
    payload: SearchBaseRequest,
    vector_field: str,
    vector: str,
    *,
    identity_field: str | None = None,
) -> SolrHttpResponse:
    return await solr.request_with_metadata(
        "POST",
        f"/{quote(payload.collection, safe='')}/select",
        data=_search_form(
            payload,
            vector_field,
            vector,
            identity_field=identity_field,
        ),
        timeout_seconds=(payload.timeout_ms / 1000) + 1,
    )


async def _request_lexical_search(
    solr: SolrClient,
    payload: SearchBaseRequest,
    *,
    rows: int,
    identity_field: str | None = None,
) -> SolrHttpResponse:
    return await solr.request_with_metadata(
        "POST",
        f"/{quote(payload.collection, safe='')}/select",
        data=_lexical_search_form(
            payload,
            rows=rows,
            identity_field=identity_field,
        ),
        timeout_seconds=(payload.timeout_ms / 1000) + 1,
    )


def _document_key(document: dict[str, Any], index: int) -> str:
    for field in (_FUSION_ID_FIELD, "id", "_version_"):
        value = document.get(field)
        if isinstance(value, list):
            value = value[0] if value else None
        if value is not None:
            return f"{field}:{value}"
    stable = {key: value for key, value in document.items() if key != "score"}
    if stable:
        return f"document:{json.dumps(stable, sort_keys=True, default=str)}"
    return f"position:{index}"


def _weighted_rrf(
    field_results: list[dict[str, Any]],
    weights: dict[str, float],
    *,
    rrf_k: int,
    limit: int,
) -> list[dict[str, Any]]:
    fused: dict[str, dict[str, Any]] = {}
    for result in field_results:
        if result["status"] != "ok":
            continue
        vector_field = result["vector_field"]
        weight = weights.get(vector_field, 1.0)
        if weight <= 0:
            continue
        documents = result.get("response", {}).get("response", {}).get("docs", [])
        for index, document in enumerate(documents):
            if not isinstance(document, dict):
                continue
            key = _document_key(document, index)
            rank = index + 1
            contribution = weight / (rrf_k + rank)
            entry = fused.setdefault(
                key,
                {
                    "document": document,
                    "score": 0.0,
                    "ranks": {},
                    "source_scores": {},
                },
            )
            entry["score"] += contribution
            entry["ranks"][vector_field] = rank
            if isinstance(document.get("score"), (int, float)):
                entry["source_scores"][vector_field] = document["score"]

    ranked = sorted(
        fused.values(),
        key=lambda item: (-item["score"], min(item["ranks"].values())),
    )[:limit]
    return [
        {
            **{
                key: value
                for key, value in entry["document"].items()
                if key != _FUSION_ID_FIELD
            },
            "score": round(entry["score"], 8),
            "_fusion": {
                "method": "weighted_rrf",
                "ranks": entry["ranks"],
                "source_scores": entry["source_scores"],
            },
        }
        for entry in ranked
    ]


def _field_result(
    source: str,
    upstream: SolrHttpResponse | BaseException,
) -> dict[str, Any]:
    if isinstance(upstream, BaseException):
        detail = upstream.detail if isinstance(upstream, HTTPException) else {"message": str(upstream)}
        return {
            "vector_field": source,
            "status": "error",
            "error": detail,
        }
    return {
        "vector_field": source,
        "status": "ok",
        "solr_ms": round(upstream.duration_ms, 3),
        "response": upstream.body,
    }


def _compact_field_result(result: dict[str, Any]) -> dict[str, Any]:
    summary = {
        key: result[key]
        for key in ("vector_field", "status", "solr_ms", "error", "reason")
        if key in result
    }
    if result.get("status") != "ok":
        return summary

    response = result.get("response", {}).get("response", {})
    documents = response.get("docs", [])
    documents = documents if isinstance(documents, list) else []
    summary["returned"] = len(documents)
    if isinstance(response.get("numFound"), int):
        summary["num_found"] = response["numFound"]
    score_samples = [
        document["score"]
        for document in documents
        if isinstance(document, dict)
        and isinstance(document.get("score"), (int, float))
        and not isinstance(document.get("score"), bool)
    ]
    if score_samples:
        summary["score_samples"] = score_samples
    return summary


@router.post("")
async def search(
    payload: SearchRequest,
    solr: SolrClient = Depends(get_solr_client),
    embeddings: EmbeddingService = Depends(get_embedding_service),
):
    started = perf_counter()
    schema_started = perf_counter()
    schema = await require_collection_schema(
        solr,
        payload.collection,
        expected_dimension=embeddings.dimension,
        vector_field=payload.vector_field,
        lexical_fields=payload.lexical_fields,
        return_fields=payload.return_fields,
        timeout_seconds=(payload.timeout_ms / 1000) + 1,
    )
    schema_ms = _elapsed_ms(schema_started)
    uses_vector = not (
        payload.mode == "hybrid"
        and payload.hybrid_strategy == "rrf"
        and payload.vector_weight <= 0
    )
    if uses_vector:
        query_vector, model_load_ms, embedding_ms, cold_start, embedding_cache_hit = await _prepare_embedding(
            embeddings,
            payload.text,
        )
        vector = _vector_literal(query_vector)
    else:
        model_load_ms = 0.0
        embedding_ms = 0.0
        cold_start = False
        embedding_cache_hit = False
        vector = ""
    solr_started = perf_counter()
    if payload.mode == "hybrid" and payload.hybrid_strategy == "rrf":
        identity_field = schema.get("unique_key")
        vector_payload = payload.model_copy(
            update={
                "mode": "semantic",
                "limit": max(payload.limit, payload.vector_candidates),
            },
        )
        request_sources: list[str] = []
        requests = []
        if payload.vector_weight > 0:
            request_sources.append(payload.vector_field)
            requests.append(
                _request_search(
                    solr,
                    vector_payload,
                    payload.vector_field,
                    vector,
                    identity_field=identity_field,
                )
            )
        if payload.lexical_weight > 0:
            request_sources.append(_LEXICAL_SOURCE)
            requests.append(
                _request_lexical_search(
                    solr,
                    payload,
                    rows=max(payload.limit, payload.lexical_candidates),
                    identity_field=identity_field,
                )
            )
        upstream_results = await asyncio.gather(*requests, return_exceptions=True)
        active_results = {
            source: _field_result(source, upstream)
            for source, upstream in zip(request_sources, upstream_results, strict=True)
        }
        field_results = [
            active_results.get(
                source,
                {
                    "vector_field": source,
                    "status": "skipped",
                    "reason": "Fusion weight is zero.",
                },
            )
            for source in (payload.vector_field, _LEXICAL_SOURCE)
        ]
        if not any(result["status"] == "ok" for result in field_results):
            raise HTTPException(
                status_code=502,
                detail={"message": "All hybrid search sources failed.", "field_results": field_results},
            )
        fusion_started = perf_counter()
        documents = _weighted_rrf(
            field_results,
            {
                payload.vector_field: payload.vector_weight,
                _LEXICAL_SOURCE: payload.lexical_weight,
            },
            rrf_k=payload.hybrid_rrf_k,
            limit=payload.limit,
        )
        field_results = [_compact_field_result(result) for result in field_results]
        fusion_ms = _elapsed_ms(fusion_started)
        solr_ms = _elapsed_ms(solr_started)
        timings = _timing_breakdown(
            started,
            schema_ms=schema_ms,
            model_load_ms=model_load_ms,
            embedding_ms=embedding_ms,
            solr_ms=solr_ms,
            fusion_ms=fusion_ms,
            cold_start=cold_start,
            embedding_cache_hit=embedding_cache_hit,
        )
        return {
            "collection": payload.collection,
            "vector_field": payload.vector_field,
            "mode": payload.mode,
            "hybrid_strategy": payload.hybrid_strategy,
            "fusion_method": "weighted_rrf",
            "source_weights": {
                payload.vector_field: payload.vector_weight,
                _LEXICAL_SOURCE: payload.lexical_weight,
            },
            "rrf_k": payload.hybrid_rrf_k,
            "model": embeddings.model_name,
            "dimension": embeddings.dimension,
            "timings": timings,
            "field_results": field_results,
            "response": {
                "response": {
                    "numFound": len(documents),
                    "start": 0,
                    "docs": documents,
                }
            },
        }

    upstream = await _request_search(solr, payload, payload.vector_field, vector)
    solr_ms = _elapsed_ms(solr_started)
    timings = _timing_breakdown(
        started,
        schema_ms=schema_ms,
        model_load_ms=model_load_ms,
        embedding_ms=embedding_ms,
        solr_ms=solr_ms,
        cold_start=cold_start,
        embedding_cache_hit=embedding_cache_hit,
    )
    return {
        "collection": payload.collection,
        "vector_field": payload.vector_field,
        "mode": payload.mode,
        "hybrid_strategy": payload.hybrid_strategy,
        "model": embeddings.model_name,
        "dimension": embeddings.dimension,
        "timings": timings,
        "response": upstream.body,
    }


@router.post("/fuse")
async def fuse_search(
    payload: SearchFuseRequest,
    solr: SolrClient = Depends(get_solr_client),
    embeddings: EmbeddingService = Depends(get_embedding_service),
):
    started = perf_counter()
    schema_started = perf_counter()
    schema = await require_collection_schema(
        solr,
        payload.collection,
        expected_dimension=embeddings.dimension,
        vector_field=payload.vector_fields[0],
        lexical_fields=payload.lexical_fields,
        return_fields=payload.return_fields,
        timeout_seconds=(payload.timeout_ms / 1000) + 1,
    )
    for vector_field in payload.vector_fields[1:]:
        require_vector_field(schema, vector_field, expected_dimension=embeddings.dimension)

    rrf_hybrid = payload.mode == "hybrid" and payload.hybrid_strategy == "rrf"
    weights = {field: payload.vector_weights.get(field, 1.0) for field in payload.vector_fields}
    if rrf_hybrid:
        weights[_LEXICAL_SOURCE] = payload.lexical_weight
    active_fields = [field for field in payload.vector_fields if weights[field] > 0]
    schema_ms = _elapsed_ms(schema_started)
    if active_fields:
        query_vector, model_load_ms, embedding_ms, cold_start, embedding_cache_hit = await _prepare_embedding(
            embeddings,
            payload.text,
        )
        vector = _vector_literal(query_vector)
    else:
        model_load_ms = 0.0
        embedding_ms = 0.0
        cold_start = False
        embedding_cache_hit = False
        vector = ""
    candidate_payload = payload.model_copy(
        update={
            "mode": "semantic" if rrf_hybrid else payload.mode,
            "limit": max(payload.limit, payload.fusion_candidates),
            "vector_candidates": max(payload.vector_candidates, payload.fusion_candidates),
            "rerank_docs": max(payload.rerank_docs, payload.fusion_candidates),
        },
    )
    solr_started = perf_counter()
    identity_field = schema.get("unique_key")
    request_sources = list(active_fields)
    requests = [
        _request_search(
            solr,
            candidate_payload,
            vector_field,
            vector,
            identity_field=identity_field,
        )
        for vector_field in active_fields
    ]
    if rrf_hybrid and payload.lexical_weight > 0:
        request_sources.append(_LEXICAL_SOURCE)
        requests.append(
            _request_lexical_search(
                solr,
                payload,
                rows=max(payload.limit, payload.lexical_candidates),
                identity_field=identity_field,
            )
        )
    upstream_results = await asyncio.gather(
        *requests,
        return_exceptions=True,
    )
    solr_ms = _elapsed_ms(solr_started)
    active_results: dict[str, dict[str, Any]] = {}
    for source, upstream in zip(request_sources, upstream_results, strict=True):
        active_results[source] = _field_result(source, upstream)

    field_results = [
        active_results.get(
            vector_field,
            {
                "vector_field": vector_field,
                "status": "skipped",
                "reason": "Fusion weight is zero.",
            },
        )
        for vector_field in payload.vector_fields
    ]
    if rrf_hybrid:
        field_results.append(
            active_results.get(
                _LEXICAL_SOURCE,
                {
                    "vector_field": _LEXICAL_SOURCE,
                    "status": "skipped",
                    "reason": "Fusion weight is zero.",
                },
            )
        )

    if not any(result["status"] == "ok" for result in field_results):
        raise HTTPException(
            status_code=502,
            detail={"message": "All fusion sources failed.", "field_results": field_results},
        )

    fusion_started = perf_counter()
    documents = _weighted_rrf(field_results, weights, rrf_k=payload.rrf_k, limit=payload.limit)
    field_results = [_compact_field_result(result) for result in field_results]
    fusion_ms = _elapsed_ms(fusion_started)
    timings = _timing_breakdown(
        started,
        schema_ms=schema_ms,
        model_load_ms=model_load_ms,
        embedding_ms=embedding_ms,
        solr_ms=solr_ms,
        fusion_ms=fusion_ms,
        cold_start=cold_start,
        embedding_cache_hit=embedding_cache_hit,
    )
    return {
        "collection": payload.collection,
        "vector_fields": payload.vector_fields,
        "vector_min_scores": payload.vector_min_scores,
        "vector_weights": {
            field: weights[field]
            for field in payload.vector_fields
        },
        "source_weights": weights,
        "mode": payload.mode,
        "hybrid_strategy": payload.hybrid_strategy,
        "lexical_weight": payload.lexical_weight,
        "fusion_method": "weighted_rrf",
        "fusion_candidates": payload.fusion_candidates,
        "rrf_k": payload.rrf_k,
        "model": embeddings.model_name,
        "dimension": embeddings.dimension,
        "embedding_ms": timings["embedding_ms"],
        "total_ms": timings["total_ms"],
        "timings": timings,
        "field_results": field_results,
        "response": {
            "response": {
                "numFound": len(documents),
                "start": 0,
                "docs": documents,
            }
        },
    }


@router.post("/compare")
async def compare_search(
    payload: SearchCompareRequest,
    solr: SolrClient = Depends(get_solr_client),
    embeddings: EmbeddingService = Depends(get_embedding_service),
):
    started = perf_counter()
    schema_started = perf_counter()
    schema = await require_collection_schema(
        solr,
        payload.collection,
        expected_dimension=embeddings.dimension,
        vector_field=payload.vector_fields[0],
        lexical_fields=payload.lexical_fields,
        return_fields=payload.return_fields,
        timeout_seconds=(payload.timeout_ms / 1000) + 1,
    )
    for vector_field in payload.vector_fields[1:]:
        require_vector_field(schema, vector_field, expected_dimension=embeddings.dimension)

    rrf_hybrid = payload.mode == "hybrid" and payload.hybrid_strategy == "rrf"
    uses_vector = not (rrf_hybrid and payload.vector_weight <= 0)
    schema_ms = _elapsed_ms(schema_started)
    if uses_vector:
        query_vector, model_load_ms, embedding_ms, cold_start, embedding_cache_hit = await _prepare_embedding(
            embeddings,
            payload.text,
        )
        vector = _vector_literal(query_vector)
    else:
        model_load_ms = 0.0
        embedding_ms = 0.0
        cold_start = False
        embedding_cache_hit = False
        vector = ""
    solr_started = perf_counter()
    identity_field = schema.get("unique_key") if rrf_hybrid else None
    vector_payload = payload.model_copy(
        update={
            "mode": "semantic",
            "limit": max(payload.limit, payload.vector_candidates),
        },
    ) if rrf_hybrid else payload
    vector_requests = [
        _request_search(
            solr,
            vector_payload,
            vector_field,
            vector,
            identity_field=identity_field,
        )
        for vector_field in payload.vector_fields
    ] if uses_vector else []
    requests = list(vector_requests)
    if rrf_hybrid and payload.lexical_weight > 0:
        requests.append(
            _request_lexical_search(
                solr,
                payload,
                rows=max(payload.limit, payload.lexical_candidates),
                identity_field=identity_field,
            )
        )
    upstream_results = await asyncio.gather(*requests, return_exceptions=True)
    solr_ms = _elapsed_ms(solr_started)
    results: list[dict[str, Any]] = []
    vector_upstreams = upstream_results[:len(vector_requests)]
    lexical_result = (
        _field_result(_LEXICAL_SOURCE, upstream_results[len(vector_requests)])
        if rrf_hybrid and payload.lexical_weight > 0
        else {
            "vector_field": _LEXICAL_SOURCE,
            "status": "skipped",
            "reason": "Fusion weight is zero.",
        }
    )
    for index, vector_field in enumerate(payload.vector_fields):
        vector_result = (
            _field_result(vector_field, vector_upstreams[index])
            if uses_vector
            else {
                "vector_field": vector_field,
                "status": "skipped",
                "reason": "Fusion weight is zero.",
            }
        )
        if rrf_hybrid:
            source_results = [vector_result, lexical_result]
            if not any(source["status"] == "ok" for source in source_results):
                results.append(
                    {
                        "vector_field": vector_field,
                        "status": "error",
                        "error": {"message": "All hybrid search sources failed."},
                        "source_results": source_results,
                    }
                )
                continue
            documents = _weighted_rrf(
                source_results,
                {
                    vector_field: payload.vector_weight,
                    _LEXICAL_SOURCE: payload.lexical_weight,
                },
                rrf_k=payload.hybrid_rrf_k,
                limit=payload.limit,
            )
            results.append(
                {
                    "vector_field": vector_field,
                    "status": "ok",
                    "solr_ms": round(sum(source.get("solr_ms", 0) for source in source_results), 3),
                    "response": {
                        "response": {
                            "numFound": len(documents),
                            "start": 0,
                            "docs": documents,
                        }
                    },
                    "source_results": source_results,
                }
            )
            continue
        if vector_result["status"] == "error":
            results.append(vector_result)
            continue
        upstream = vector_upstreams[index]
        results.append(
            {
                "vector_field": vector_field,
                "status": "ok",
                "solr_ms": round(upstream.duration_ms, 3),
                "response": upstream.body,
            }
        )

    if rrf_hybrid:
        for result in results:
            if "source_results" in result:
                result["source_results"] = [
                    _compact_field_result(source)
                    for source in result["source_results"]
                ]

    timings = _timing_breakdown(
        started,
        schema_ms=schema_ms,
        model_load_ms=model_load_ms,
        embedding_ms=embedding_ms,
        solr_ms=solr_ms,
        cold_start=cold_start,
        embedding_cache_hit=embedding_cache_hit,
    )
    return {
        "collection": payload.collection,
        "vector_fields": payload.vector_fields,
        "vector_min_scores": payload.vector_min_scores,
        "mode": payload.mode,
        "hybrid_strategy": payload.hybrid_strategy,
        "lexical_weight": payload.lexical_weight,
        "vector_weight": payload.vector_weight,
        "rrf_k": payload.hybrid_rrf_k if rrf_hybrid else None,
        "model": embeddings.model_name,
        "dimension": embeddings.dimension,
        "embedding_ms": timings["embedding_ms"],
        "total_ms": timings["total_ms"],
        "timings": timings,
        "results": results,
    }
