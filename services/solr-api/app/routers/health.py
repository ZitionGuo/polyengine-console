from typing import Any

from fastapi import APIRouter, Depends

from ..embeddings import EmbeddingService, get_embedding_service
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
