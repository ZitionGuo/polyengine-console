from math import sqrt
from statistics import fmean
from time import perf_counter
from typing import Any

from fastapi import APIRouter, Depends

from ..embeddings import EmbeddingService, get_embedding_service
from ..models import EmbeddingPreviewRequest
from ..solr import SolrClient, get_solr_client


router = APIRouter(tags=["health"])


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


@router.get("/health")
async def health(
    solr: SolrClient = Depends(get_solr_client),
    embeddings: EmbeddingService = Depends(get_embedding_service),
):
    system = await solr.system_info()
    lucene = _as_dict(system.get("lucene"))
    mode = str(system.get("mode", "solrcloud")).lower()
    return {
        "status": "ok",
        "solr": {
            "version": lucene.get("solr-spec-version") or lucene.get("solr-impl-version"),
            "mode": mode,
            "endpoint": solr.endpoint,
            "admin_url": solr.admin_url,
        },
        "model": embeddings.status(),
    }


@router.get("/model")
async def model_status(embeddings: EmbeddingService = Depends(get_embedding_service)):
    return embeddings.status()


@router.post("/model/load")
async def load_model(embeddings: EmbeddingService = Depends(get_embedding_service)):
    return await embeddings.load()


@router.post("/model/embed")
async def preview_embedding(
    payload: EmbeddingPreviewRequest,
    embeddings: EmbeddingService = Depends(get_embedding_service),
):
    started = perf_counter()
    cold_start = embeddings.status()["status"] != "ready"
    load_started = perf_counter()
    await embeddings.load()
    model_load_ms = (perf_counter() - load_started) * 1000
    vector, embedding_ms, cache_hit = await embeddings.encode_query(payload.text)
    total_ms = (perf_counter() - started) * 1000
    return {
        "model": embeddings.model_name,
        "dimension": len(vector),
        "vector": vector,
        "statistics": {
            "l2_norm": round(sqrt(sum(value * value for value in vector)), 8),
            "minimum": round(min(vector), 8),
            "maximum": round(max(vector), 8),
            "mean": round(fmean(vector), 8),
        },
        "timings": {
            "model_load_ms": round(model_load_ms, 3),
            "embedding_ms": round(embedding_ms, 3),
            "total_ms": round(total_ms, 3),
        },
        "cold_start": cold_start,
        "cache_hit": cache_hit,
    }
