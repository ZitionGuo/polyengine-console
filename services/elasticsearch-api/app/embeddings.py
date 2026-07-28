import asyncio
from collections import OrderedDict
from hashlib import sha256
from time import monotonic, perf_counter
from typing import Any

from fastapi import HTTPException, Request

from .config import Settings


class EmbeddingService:
    def __init__(self, settings: Settings):
        self.model_name = settings.embedding_model
        self.dimension = settings.embedding_dimension
        self.query_instruction = settings.embedding_query_instruction
        self._model: Any | None = None
        self._state = "not_loaded"
        self._error: str | None = None
        self._lock = asyncio.Lock()
        self._cache_size = settings.query_embedding_cache_size
        self._cache_ttl = settings.query_embedding_cache_ttl_seconds
        self._cache: OrderedDict[str, tuple[float, list[float]]] = OrderedDict()
        self._cache_lock = asyncio.Lock()

    def status(self) -> dict[str, Any]:
        return {
            "name": self.model_name,
            "dimension": self.dimension,
            "status": self._state,
            "error": self._error,
            "query_instruction": self.query_instruction,
            "query_cache": {
                "entries": len(self._cache),
                "capacity": self._cache_size,
                "ttl_seconds": self._cache_ttl,
            },
        }

    def _query_text(self, text: str) -> str:
        return f"Instruct: {self.query_instruction}\nQuery: {text}"

    def _load_model(self):
        from sentence_transformers import SentenceTransformer

        return SentenceTransformer(self.model_name, truncate_dim=self.dimension)

    async def load(self) -> dict[str, Any]:
        if self._model is not None:
            return self.status()
        async with self._lock:
            if self._model is not None:
                return self.status()
            self._state = "loading"
            self._error = None
            try:
                self._model = await asyncio.to_thread(self._load_model)
                probe = await asyncio.to_thread(
                    self._model.encode,
                    [self._query_text("dimension probe")],
                    normalize_embeddings=True,
                    convert_to_numpy=True,
                    show_progress_bar=False,
                )
                if len(probe[0]) != self.dimension:
                    raise RuntimeError(
                        f"Model returned {len(probe[0])} dimensions; expected {self.dimension}."
                    )
                self._state = "ready"
            except Exception as exc:  # noqa: BLE001
                self._model = None
                self._state = "error"
                self._error = str(exc)
                raise HTTPException(
                    status_code=503,
                    detail={
                        "message": "Unable to load the Elasticsearch embedding model.",
                        "upstream_status": None,
                        "upstream_body": str(exc),
                    },
                ) from exc
        return self.status()

    async def encode_query(self, text: str) -> tuple[list[float], float, bool]:
        await self.load()
        key = sha256(text.encode("utf-8")).hexdigest()
        started = perf_counter()
        if self._cache_size > 0 and self._cache_ttl > 0:
            async with self._cache_lock:
                cached = self._cache.get(key)
                if cached is not None and cached[0] > monotonic():
                    self._cache.move_to_end(key)
                    return list(cached[1]), (perf_counter() - started) * 1000, True
                if cached is not None:
                    self._cache.pop(key, None)

        vectors = await asyncio.to_thread(
            self._model.encode,
            [self._query_text(text)],
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        vector = vectors[0].astype(float).tolist()
        elapsed_ms = (perf_counter() - started) * 1000
        if self._cache_size > 0 and self._cache_ttl > 0:
            async with self._cache_lock:
                self._cache[key] = (monotonic() + self._cache_ttl, list(vector))
                self._cache.move_to_end(key)
                while len(self._cache) > self._cache_size:
                    self._cache.popitem(last=False)
        return vector, elapsed_ms, False

    async def encode_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        await self.load()
        vectors = await asyncio.to_thread(
            self._model.encode,
            texts,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return [vector.astype(float).tolist() for vector in vectors]

    async def clear_cache(self) -> dict[str, Any]:
        async with self._cache_lock:
            cleared = len(self._cache)
            self._cache.clear()
        return {"cleared": cleared, "model": self.status()}


def get_embedding_service(request: Request) -> EmbeddingService:
    return request.app.state.embedding_service
