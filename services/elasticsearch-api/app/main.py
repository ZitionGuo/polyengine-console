from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .elasticsearch import ElasticsearchClient
from .embeddings import EmbeddingService
from .routers import health, indices, inference, model, search


def create_app() -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        client = ElasticsearchClient(settings)
        app.state.elasticsearch_client = client
        app.state.embedding_service = EmbeddingService(settings)
        try:
            yield
        finally:
            await client.aclose()

    app = FastAPI(title="PolyEngine Elasticsearch API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router, prefix="/api")
    app.include_router(indices.router, prefix="/api")
    app.include_router(inference.router, prefix="/api")
    app.include_router(model.router, prefix="/api")
    app.include_router(search.router, prefix="/api")
    return app


app = create_app()
