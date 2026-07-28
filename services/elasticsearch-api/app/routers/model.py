import math
from time import perf_counter

from fastapi import APIRouter, Depends

from ..embeddings import EmbeddingService, get_embedding_service
from ..models import EmbeddingPreviewRequest


router = APIRouter(prefix="/model", tags=["model"])


@router.get("")
async def model_status(embeddings: EmbeddingService = Depends(get_embedding_service)):
    return embeddings.status()


@router.post("/load")
async def load_model(embeddings: EmbeddingService = Depends(get_embedding_service)):
    return await embeddings.load()


@router.delete("/cache")
async def clear_model_cache(embeddings: EmbeddingService = Depends(get_embedding_service)):
    return await embeddings.clear_cache()


@router.post("/preview")
async def preview_embedding(
    payload: EmbeddingPreviewRequest,
    embeddings: EmbeddingService = Depends(get_embedding_service),
):
    cold_start = embeddings.status()["status"] != "ready"
    started = perf_counter()
    vector, embedding_ms, cache_hit = await embeddings.encode_query(payload.text)
    total_ms = (perf_counter() - started) * 1000
    return {
        "model": embeddings.model_name,
        "dimension": len(vector),
        "vector": vector,
        "statistics": {
            "l2_norm": math.sqrt(sum(value * value for value in vector)),
            "minimum": min(vector),
            "maximum": max(vector),
            "mean": sum(vector) / len(vector),
        },
        "timings": {
            "embedding_ms": round(embedding_ms, 3),
            "total_ms": round(total_ms, 3),
        },
        "cold_start": cold_start,
        "cache_hit": cache_hit,
    }
