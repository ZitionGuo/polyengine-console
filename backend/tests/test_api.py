from typing import Any

import httpx
import pytest
from fastapi import HTTPException

from app.config import Settings
from app.main import create_app
from app.qdrant import QdrantClient, get_qdrant_client


class RecordingQdrantClient:
    def __init__(self):
        self.calls: list[dict[str, Any]] = []

    async def request(self, method: str, path: str, **kwargs):
        self.calls.append({"method": method, "path": path, **kwargs})
        return {"ok": True, "path": path}


def make_test_app(client: RecordingQdrantClient):
    app = create_app()
    app.dependency_overrides[get_qdrant_client] = lambda: client
    return app


@pytest.mark.anyio
async def test_alias_list_uses_global_alias_endpoint():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/aliases")

    assert response.status_code == 200
    assert fake.calls == [{"method": "GET", "path": "/aliases"}]


@pytest.mark.anyio
async def test_alias_create_maps_to_qdrant_action_payload():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/aliases",
            json={"collection_name": "docs", "alias_name": "docs_live"},
        )

    assert response.status_code == 200
    assert fake.calls == [
        {
            "method": "POST",
            "path": "/collections/aliases",
            "json": {
                "actions": [
                    {
                        "create_alias": {
                            "collection_name": "docs",
                            "alias_name": "docs_live",
                        }
                    }
                ]
            },
        }
    ]


@pytest.mark.anyio
async def test_collection_create_keeps_collection_when_index_fails():
    class PartiallyFailingClient(RecordingQdrantClient):
        async def request(self, method: str, path: str, **kwargs):
            self.calls.append({"method": method, "path": path, **kwargs})
            if path == "/collections/docs/index" and kwargs["json"]["field_name"] == "bad":
                raise HTTPException(
                    status_code=400,
                    detail={
                        "message": "Qdrant returned an error.",
                        "upstream_status": 400,
                        "upstream_body": {"status": "error"},
                    },
                )
            return {"ok": True}

    fake = PartiallyFailingClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.put(
            "/api/collections/docs",
            json={
                "config": {"vectors": {"size": 4, "distance": "Cosine"}},
                "indexes": [
                    {"field_name": "title", "field_schema": "keyword"},
                    {"field_name": "bad", "field_schema": "integer"},
                ],
            },
        )

    body = response.json()
    assert response.status_code == 200
    assert body["collection"] == {"ok": True}
    assert body["indexes"] == [{"field_name": "title", "result": {"ok": True}}]
    assert body["index_errors"][0]["field_name"] == "bad"
    assert fake.calls[0] == {
        "method": "PUT",
        "path": "/collections/docs",
        "json": {"vectors": {"size": 4, "distance": "Cosine"}},
    }


@pytest.mark.anyio
async def test_rest_proxy_rejects_absolute_urls():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/rest",
            json={"method": "GET", "path": "https://example.com/collections"},
        )

    assert response.status_code == 400
    assert response.json()["detail"]["message"] == "Only relative Qdrant API paths are allowed."
    assert fake.calls == []


@pytest.mark.anyio
async def test_scroll_points_maps_to_collection_scroll_endpoint():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/collections/docs/points/scroll",
            json={
                "limit": 10,
                "offset": 123,
                "with_payload": True,
                "with_vector": False,
                "filter": {"must": [{"key": "source", "match": {"value": "demo"}}]},
            },
        )

    assert response.status_code == 200
    assert fake.calls == [
        {
            "method": "POST",
            "path": "/collections/docs/points/scroll",
            "json": {
                "limit": 10,
                "offset": 123,
                "with_payload": True,
                "with_vector": False,
                "filter": {"must": [{"key": "source", "match": {"value": "demo"}}]},
            },
        }
    ]


@pytest.mark.anyio
async def test_query_points_maps_to_collection_query_endpoint():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/collections/docs/points/query",
            json={
                "query": [0.1, 0.2, 0.3, 0.4],
                "using": "dense",
                "limit": 3,
                "with_payload": True,
                "with_vector": False,
                "filter": {"must": [{"key": "source", "match": {"value": "demo"}}]},
            },
        )

    assert response.status_code == 200
    assert fake.calls == [
        {
            "method": "POST",
            "path": "/collections/docs/points/query",
            "json": {
                "query": [0.1, 0.2, 0.3, 0.4],
                "using": "dense",
                "limit": 3,
                "with_payload": True,
                "with_vector": False,
                "filter": {"must": [{"key": "source", "match": {"value": "demo"}}]},
            },
        }
    ]


@pytest.mark.anyio
async def test_retrieve_points_maps_to_collection_points_endpoint():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/collections/docs/points/retrieve",
            json={"ids": [1, "abc"], "with_payload": True, "with_vector": False},
        )

    assert response.status_code == 200
    assert fake.calls == [
        {
            "method": "POST",
            "path": "/collections/docs/points",
            "json": {"ids": [1, "abc"], "with_payload": True, "with_vector": False},
        }
    ]


@pytest.mark.anyio
async def test_delete_points_maps_to_collection_delete_endpoint():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/collections/docs/points/delete?wait=true&ordering=strong",
            json={"points": [1, "abc"]},
        )

    assert response.status_code == 200
    assert fake.calls == [
        {
            "method": "POST",
            "path": "/collections/docs/points/delete",
            "params": {"wait": True, "ordering": "strong"},
            "json": {"points": [1, "abc"]},
        }
    ]


@pytest.mark.anyio
async def test_upsert_points_maps_to_collection_points_endpoint():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.put(
            "/api/collections/docs/points?wait=true&ordering=strong",
            json={
                "points": [
                    {
                        "id": 1,
                        "vector": [0.1, 0.2, 0.3, 0.4],
                        "payload": {"source": "test"},
                    }
                ]
            },
        )

    assert response.status_code == 200
    assert fake.calls == [
        {
            "method": "PUT",
            "path": "/collections/docs/points",
            "params": {"wait": True, "ordering": "strong"},
            "json": {
                "points": [
                    {
                        "id": 1,
                        "vector": [0.1, 0.2, 0.3, 0.4],
                        "payload": {"source": "test"},
                    }
                ]
            },
        }
    ]


@pytest.mark.anyio
async def test_qdrant_client_passes_through_upstream_errors():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["api-key"] == "test-qdrant-key"
        return httpx.Response(
            409,
            json={"status": "error", "result": {"reason": "exists"}},
        )

    client = QdrantClient(
        Settings(qdrant_url="http://qdrant.local", qdrant_api_key="test-qdrant-key"),
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(HTTPException) as exc_info:
        await client.request("PUT", "/collections/docs", json={"vectors": {}})

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == {
        "message": "Qdrant returned an error.",
        "upstream_status": 409,
        "upstream_body": {"status": "error", "result": {"reason": "exists"}},
    }
