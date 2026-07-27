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
        self._model: Any | None = None
        self._state = "not_loaded"
        self._error: str | None = None
        self._lock = asyncio.Lock()
        self._query_cache_size = settings.query_embedding_cache_size
        self._query_cache_ttl = settings.query_embedding_cache_ttl_seconds
        self._query_cache: OrderedDict[str, tuple[float, list[float]]] = OrderedDict()
        self._query_cache_lock = asyncio.Lock()

    def status(self) -> dict[str, Any]:
        return {
            "name": self.model_name,
            "dimension": self.dimension,
            "status": self._state,
            "error": self._error,
            "query_cache": {
                "entries": len(self._query_cache),
                "capacity": self._query_cache_size,
                "ttl_seconds": self._query_cache_ttl,
            },
        }

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
                    ["dimension probe"],
                    normalize_embeddings=True,
                    convert_to_numpy=True,
                )
                if len(probe[0]) != self.dimension:
                    raise RuntimeError(
                        f"Model returned {len(probe[0])} dimensions; expected {self.dimension}."
                    )
                self._state = "ready"
            except Exception as exc:  # noqa: BLE001 - expose a useful local model error
                self._model = None
                self._state = "error"
                self._error = str(exc)
                raise HTTPException(
                    status_code=503,
                    detail={
                        "message": "Unable to load the embedding model.",
                        "upstream_status": None,
                        "upstream_body": str(exc),
                    },
                ) from exc
        return self.status()

    async def encode(self, texts: list[str]) -> tuple[list[list[float]], float]:
        if not texts:
            return [], 0.0
        await self.load()
        started = perf_counter()
        vectors = await asyncio.to_thread(
            self._model.encode,
            texts,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return [vector.astype(float).tolist() for vector in vectors], (perf_counter() - started) * 1000

    async def encode_query(self, text: str) -> tuple[list[float], float, bool]:
        if self._query_cache_size <= 0 or self._query_cache_ttl <= 0:
            vectors, elapsed_ms = await self.encode([text])
            return vectors[0], elapsed_ms, False

        started = perf_counter()
        key = sha256(text.encode("utf-8")).hexdigest()
        async with self._query_cache_lock:
            cached = self._query_cache.get(key)
            if cached is not None and cached[0] > monotonic():
                self._query_cache.move_to_end(key)
                return list(cached[1]), (perf_counter() - started) * 1000, True
            if cached is not None:
                self._query_cache.pop(key, None)

            vectors, _ = await self.encode([text])
            vector = vectors[0]
            self._query_cache[key] = (monotonic() + self._query_cache_ttl, list(vector))
            self._query_cache.move_to_end(key)
            while len(self._query_cache) > self._query_cache_size:
                self._query_cache.popitem(last=False)
            return list(vector), (perf_counter() - started) * 1000, False

    def _load_model(self):
        from sentence_transformers import SentenceTransformer

        return SentenceTransformer(self.model_name)


def get_embedding_service(request: Request) -> EmbeddingService:
    return request.app.state.embedding_service
