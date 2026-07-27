from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .qdrant import QdrantClient
from .routers import aliases, cluster, collections, health, rest, snapshots


def create_app() -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        qdrant_client = QdrantClient(settings)
        app.state.qdrant_client = qdrant_client
        try:
            yield
        finally:
            await qdrant_client.aclose()

    app = FastAPI(
        title="PolyEngine Qdrant API",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router, prefix="/api")
    app.include_router(collections.router, prefix="/api")
    app.include_router(aliases.router, prefix="/api")
    app.include_router(cluster.router, prefix="/api")
    app.include_router(snapshots.router, prefix="/api")
    app.include_router(rest.router, prefix="/api")
    return app


app = create_app()
