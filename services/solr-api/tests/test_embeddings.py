import asyncio

import numpy as np
import pytest

from app.config import Settings
from app.embeddings import EmbeddingService


class FakeModel:
    def __init__(self):
        self.calls = 0

    def encode(self, texts, **kwargs):
        self.calls += 1
        return np.array([[float(index + 1) for index in range(3)] for _ in texts])


def ready_service(*, size: int = 512, ttl: float = 900) -> tuple[EmbeddingService, FakeModel]:
    service = EmbeddingService(
        Settings(
            _env_file=None,
            embedding_dimension=3,
            query_embedding_cache_size=size,
            query_embedding_cache_ttl_seconds=ttl,
        )
    )
    model = FakeModel()
    service._model = model
    service._state = "ready"
    return service, model


@pytest.mark.anyio
async def test_query_embedding_cache_coalesces_concurrent_requests():
    service, model = ready_service()

    results = await asyncio.gather(*(service.encode_query("same query") for _ in range(6)))

    assert model.calls == 1
    assert sum(cache_hit for _, _, cache_hit in results) == 5
    results[0][0].clear()
    cached, _, cache_hit = await service.encode_query("same query")
    assert cached == [1.0, 2.0, 3.0]
    assert cache_hit is True


@pytest.mark.anyio
async def test_query_embedding_cache_is_lru_bounded():
    service, model = ready_service(size=2)

    await service.encode_query("one")
    await service.encode_query("two")
    await service.encode_query("one")
    await service.encode_query("three")
    _, _, cache_hit = await service.encode_query("two")

    assert cache_hit is False
    assert model.calls == 4
    assert service.status()["query_cache"]["entries"] == 2


@pytest.mark.anyio
async def test_query_embedding_cache_refreshes_after_ttl(monkeypatch):
    now = 100.0
    monkeypatch.setattr("app.embeddings.monotonic", lambda: now)
    service, model = ready_service(ttl=10)

    await service.encode_query("expiring query")
    _, _, cache_hit = await service.encode_query("expiring query")
    assert cache_hit is True

    now = 111.0
    _, _, cache_hit = await service.encode_query("expiring query")

    assert cache_hit is False
    assert model.calls == 2


@pytest.mark.anyio
async def test_query_embedding_cache_can_be_disabled():
    service, model = ready_service(size=0)

    first = await service.encode_query("uncached")
    second = await service.encode_query("uncached")

    assert first[2] is False
    assert second[2] is False
    assert model.calls == 2
