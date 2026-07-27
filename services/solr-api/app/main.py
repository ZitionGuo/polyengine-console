from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .embeddings import EmbeddingService
from .jobs import IngestManager
from .routers import collections, health, ingest, search
from .solr import SolrClient


def create_app() -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        solr = SolrClient(settings)
        embeddings = EmbeddingService(settings)
        manager = IngestManager(settings, solr, embeddings)
        app.state.solr_client = solr
        app.state.embedding_service = embeddings
        app.state.ingest_manager = manager
        try:
            yield
        finally:
            await manager.close()
            await solr.aclose()

    app = FastAPI(title="PolyEngine Solr API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router, prefix="/api")
    app.include_router(collections.router, prefix="/api")
    app.include_router(search.router, prefix="/api")
    app.include_router(ingest.router, prefix="/api")
    return app


app = create_app()
