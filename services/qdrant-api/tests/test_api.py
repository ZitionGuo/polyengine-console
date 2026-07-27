from typing import Any

import httpx
import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.config import Settings
from app.main import create_app
from app.qdrant import QdrantClient, QdrantHttpResponse, QdrantStream, get_qdrant_client


class RecordingQdrantClient:
    def __init__(self):
        self.calls: list[dict[str, Any]] = []

    async def request(self, method: str, path: str, **kwargs):
        self.calls.append({"method": method, "path": path, **kwargs})
        return {"ok": True, "path": path}

    async def stream(self, method: str, path: str, **kwargs):
        self.calls.append({"method": method, "path": path, "stream": True, **kwargs})

        async def body():
            yield b"snapshot-data"

        return QdrantStream(
            body=body(),
            content_type="application/octet-stream",
            content_length="13",
        )

    async def request_with_metadata(self, method: str, path: str, **kwargs):
        body = await self.request(method, path, **kwargs)
        return QdrantHttpResponse(
            body=body,
            status_code=200,
            headers={
                "content-type": "application/json",
                "content-length": "27",
                "set-cookie": "should-not-leave-backend=true",
                "x-internal-secret": "hidden",
            },
            duration_ms=1.23456,
        )


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
async def test_alias_update_renames_without_recreating_alias():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.patch(
            "/api/aliases/docs_live",
            json={"new_alias_name": " docs_current "},
        )

    assert response.status_code == 200
    assert fake.calls == [
        {
            "method": "POST",
            "path": "/collections/aliases",
            "json": {
                "actions": [
                    {
                        "rename_alias": {
                            "old_alias_name": "docs_live",
                            "new_alias_name": "docs_current",
                        }
                    }
                ]
            },
        }
    ]


@pytest.mark.anyio
async def test_alias_update_reassigns_and_optionally_renames_atomically():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.patch(
            "/api/aliases/docs_live",
            json={
                "new_alias_name": "docs_current",
                "collection_name": "docs_v2",
            },
        )

    assert response.status_code == 200
    assert fake.calls == [
        {
            "method": "POST",
            "path": "/collections/aliases",
            "json": {
                "actions": [
                    {"delete_alias": {"alias_name": "docs_live"}},
                    {
                        "create_alias": {
                            "collection_name": "docs_v2",
                            "alias_name": "docs_current",
                        }
                    },
                ]
            },
        }
    ]


@pytest.mark.anyio
async def test_alias_update_requires_at_least_one_change_field():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.patch("/api/aliases/docs_live", json={})

    assert response.status_code == 422
    assert fake.calls == []


@pytest.mark.anyio
async def test_collection_overview_aggregates_runtime_metrics_and_encodes_names():
    class OverviewClient(RecordingQdrantClient):
        async def request(self, method: str, path: str, **kwargs):
            self.calls.append({"method": method, "path": path, **kwargs})
            if path == "/collections":
                return {
                    "result": {
                        "collections": [
                            {"name": "docs"},
                            {"name": "docs archive"},
                        ]
                    },
                    "status": "ok",
                }
            if path == "/collections/docs":
                return {
                    "result": {
                        "status": "green",
                        "optimizer_status": "ok",
                        "points_count": 42,
                        "vectors_count": 45,
                        "indexed_vectors_count": 40,
                        "segments_count": 3,
                        "config": {
                            "params": {
                                "vectors": {"size": 4, "distance": "Cosine"},
                                "sparse_vectors": {"text": {}},
                            }
                        },
                        "update_queue": {"length": 2},
                    }
                }
            return {
                "result": {
                    "status": "yellow",
                    "optimizer_status": "optimizing",
                    "points_count": 7,
                    "indexed_vectors_count": 0,
                    "segments_count": 1,
                    "config": {
                        "params": {
                            "vectors": {
                                "title": {"size": 4, "distance": "Cosine"},
                                "body": {"size": 8, "distance": "Dot"},
                            }
                        }
                    },
                }
            }

    fake = OverviewClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/collections?include_details=true")

    assert response.status_code == 200
    assert response.json() == {
        "result": {
            "collections": [
                {
                    "name": "docs",
                    "status": "green",
                    "optimizer_status": "ok",
                    "points_count": 42,
                    "vectors_count": 45,
                    "indexed_vectors_count": 40,
                    "segments_count": 3,
                    "dense_vector_count": 1,
                    "sparse_vector_count": 1,
                    "update_queue_length": 2,
                },
                {
                    "name": "docs archive",
                    "status": "yellow",
                    "optimizer_status": "optimizing",
                    "points_count": 7,
                    "vectors_count": None,
                    "indexed_vectors_count": 0,
                    "segments_count": 1,
                    "dense_vector_count": 2,
                    "sparse_vector_count": 0,
                    "update_queue_length": None,
                },
            ],
            "errors": [],
        },
        "status": "ok",
    }
    assert fake.calls == [
        {"method": "GET", "path": "/collections"},
        {"method": "GET", "path": "/collections/docs"},
        {"method": "GET", "path": "/collections/docs%20archive"},
    ]


@pytest.mark.anyio
async def test_collection_overview_keeps_rows_when_one_detail_fails():
    class PartiallyFailingOverviewClient(RecordingQdrantClient):
        async def request(self, method: str, path: str, **kwargs):
            self.calls.append({"method": method, "path": path, **kwargs})
            if path == "/collections":
                return {
                    "result": {"collections": [{"name": "ready"}, {"name": "offline"}]}
                }
            if path == "/collections/offline":
                raise HTTPException(
                    status_code=503,
                    detail={
                        "message": "Unable to reach Qdrant.",
                        "upstream_status": None,
                        "upstream_body": "connection reset",
                    },
                )
            return {
                "result": {
                    "status": "green",
                    "optimizer_status": "ok",
                    "points_count": 1,
                    "indexed_vectors_count": 1,
                    "segments_count": 1,
                    "config": {"params": {"vectors": {}}},
                }
            }

    fake = PartiallyFailingOverviewClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/collections?include_details=true")

    body = response.json()
    assert response.status_code == 200
    assert body["status"] == "partial"
    assert [item["name"] for item in body["result"]["collections"]] == ["ready", "offline"]
    assert body["result"]["collections"][1] == {
        "name": "offline",
        "status": "unavailable",
        "error": {
            "name": "offline",
            "status_code": 503,
            "detail": {
                "message": "Unable to reach Qdrant.",
                "upstream_status": None,
                "upstream_body": "connection reset",
            },
        },
    }
    assert body["result"]["errors"] == [body["result"]["collections"][1]["error"]]


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
    assert body["index_errors"][0]["field_schema"] == "integer"
    assert fake.calls[0] == {
        "method": "PUT",
        "path": "/collections/docs",
        "json": {"vectors": {"size": 4, "distance": "Cosine"}},
    }


@pytest.mark.anyio
async def test_collection_update_maps_supported_settings():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.patch(
            "/api/collections/docs",
            json={
                "params": {"replication_factor": 2},
                "optimizers_config": {"indexing_threshold": 25000},
                "hnsw_config": {"ef_construct": 128},
            },
        )

    assert response.status_code == 200
    assert fake.calls == [
        {
            "method": "PATCH",
            "path": "/collections/docs",
            "json": {
                "params": {"replication_factor": 2},
                "optimizers_config": {"indexing_threshold": 25000},
                "hnsw_config": {"ef_construct": 128},
            },
        }
    ]


@pytest.mark.anyio
async def test_collection_snapshot_routes_encode_snapshot_name():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        list_response = await client.get("/api/collections/docs/snapshots")
        create_response = await client.post("/api/collections/docs/snapshots?wait=true")
        delete_response = await client.delete(
            "/api/collections/docs/snapshots/nightly%202026.snapshot?wait=true"
        )

    assert list_response.status_code == 200
    assert create_response.status_code == 200
    assert delete_response.status_code == 200
    assert fake.calls == [
        {"method": "GET", "path": "/collections/docs/snapshots"},
        {
            "method": "POST",
            "path": "/collections/docs/snapshots",
            "params": {"wait": True},
        },
        {
            "method": "DELETE",
            "path": "/collections/docs/snapshots/nightly%202026.snapshot",
            "params": {"wait": True},
        },
    ]


@pytest.mark.anyio
async def test_collection_snapshot_upload_streams_multipart_with_recovery_options():
    class UploadRecordingClient(RecordingQdrantClient):
        def __init__(self):
            super().__init__()
            self.upload: tuple[str, bytes, str] | None = None
            self.upload_file = None
            self.upload_timeout: httpx.Timeout | None = None

        async def request(self, method: str, path: str, **kwargs):
            filename, file_object, content_type = kwargs["files"]["snapshot"]
            self.upload = (filename, file_object.read(), content_type)
            self.upload_file = file_object
            self.upload_timeout = kwargs["timeout"]
            self.calls.append(
                {
                    "method": method,
                    "path": path,
                    "params": kwargs["params"],
                }
            )
            return {"result": True, "status": "ok"}

    fake = UploadRecordingClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))
    checksum = "A" * 64

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            f"/api/collections/docs%20copy/snapshots/upload?wait=true&priority=snapshot&checksum={checksum}",
            files={
                "snapshot": (
                    "folder/backup.snapshot",
                    b"snapshot-bytes",
                    "application/octet-stream",
                )
            },
        )

    assert response.status_code == 200
    assert response.json() == {"result": True, "status": "ok"}
    assert fake.calls == [
        {
            "method": "POST",
            "path": "/collections/docs%20copy/snapshots/upload",
            "params": {
                "wait": True,
                "priority": "snapshot",
                "checksum": checksum.lower(),
            },
        }
    ]
    assert fake.upload == ("backup.snapshot", b"snapshot-bytes", "application/octet-stream")
    assert fake.upload_file.closed is True
    assert isinstance(fake.upload_timeout, httpx.Timeout)
    assert fake.upload_timeout.connect == 30
    assert fake.upload_timeout.read is None
    assert fake.upload_timeout.write is None
    assert fake.upload_timeout.pool == 30


@pytest.mark.anyio
async def test_collection_snapshot_upload_validates_extension_checksum_and_priority():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        extension_response = await client.post(
            "/api/collections/docs/snapshots/upload",
            files={"snapshot": ("backup.zip", b"not-a-snapshot")},
        )
        checksum_response = await client.post(
            "/api/collections/docs/snapshots/upload?checksum=invalid",
            files={"snapshot": ("backup.snapshot", b"snapshot")},
        )
        priority_response = await client.post(
            "/api/collections/docs/snapshots/upload?priority=unknown",
            files={"snapshot": ("backup.snapshot", b"snapshot")},
        )

    assert extension_response.status_code == 400
    assert extension_response.json()["detail"]["message"] == (
        "Snapshot files must use the .snapshot extension."
    )
    assert checksum_response.status_code == 422
    assert priority_response.status_code == 422
    assert fake.calls == []


@pytest.mark.anyio
async def test_collection_snapshot_download_streams_file_with_safe_filename():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/collections/docs/snapshots/nightly%202026.snapshot"
        )

    assert response.status_code == 200
    assert response.content == b"snapshot-data"
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["content-length"] == "13"
    assert response.headers["content-disposition"] == (
        "attachment; filename*=UTF-8''nightly%202026.snapshot"
    )
    assert fake.calls == [
        {
            "method": "GET",
            "path": "/collections/docs/snapshots/nightly%202026.snapshot",
            "stream": True,
        }
    ]


@pytest.mark.anyio
async def test_storage_snapshot_list_create_and_delete_proxy_qdrant_endpoints():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        list_response = await client.get("/api/snapshots")
        create_response = await client.post("/api/snapshots?wait=true")
        delete_response = await client.delete(
            "/api/snapshots/full%20backup%231.snapshot?wait=false"
        )

    assert list_response.status_code == 200
    assert create_response.status_code == 200
    assert delete_response.status_code == 200
    assert fake.calls[0] == {"method": "GET", "path": "/snapshots"}
    assert fake.calls[1]["method"] == "POST"
    assert fake.calls[1]["path"] == "/snapshots"
    assert fake.calls[1]["params"] == {"wait": True}
    assert isinstance(fake.calls[1]["timeout"], httpx.Timeout)
    assert fake.calls[1]["timeout"].read is None
    assert fake.calls[2] == {
        "method": "DELETE",
        "path": "/snapshots/full%20backup%231.snapshot",
        "params": {"wait": False},
    }


@pytest.mark.anyio
async def test_storage_snapshot_download_streams_file_with_safe_filename():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/snapshots/full%20backup%232.snapshot")

    assert response.status_code == 200
    assert response.content == b"snapshot-data"
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["content-length"] == "13"
    assert response.headers["content-disposition"] == (
        "attachment; filename*=UTF-8''full%20backup%232.snapshot"
    )
    assert fake.calls == [
        {
            "method": "GET",
            "path": "/snapshots/full%20backup%232.snapshot",
            "stream": True,
        }
    ]


@pytest.mark.anyio
async def test_collection_optimizations_includes_optional_sections():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/collections/docs/optimizations?completed_limit=5"
        )

    assert response.status_code == 200
    assert fake.calls == [
        {
            "method": "GET",
            "path": "/collections/docs/optimizations",
            "params": {
                "with": "queued,completed,idle_segments",
                "completed_limit": 5,
            },
        }
    ]


@pytest.mark.anyio
async def test_point_count_and_facet_proxy_filters_with_encoded_collection_name():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))
    point_filter = {
        "must": [{"key": "category", "match": {"value": "news"}}]
    }

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        count_response = await client.post(
            "/api/collections/docs%20copy/points/count",
            json={"filter": point_filter, "exact": True},
        )
        facet_response = await client.post(
            "/api/collections/docs%20copy/points/facet",
            json={
                "key": "source.type",
                "limit": 25,
                "filter": point_filter,
                "exact": False,
            },
        )

    assert count_response.status_code == 200
    assert facet_response.status_code == 200
    assert fake.calls == [
        {
            "method": "POST",
            "path": "/collections/docs%20copy/points/count",
            "json": {"filter": point_filter, "exact": True},
        },
        {
            "method": "POST",
            "path": "/collections/docs%20copy/facet",
            "json": {
                "key": "source.type",
                "limit": 25,
                "filter": point_filter,
                "exact": False,
            },
        },
    ]


@pytest.mark.anyio
async def test_point_facet_validates_key_and_limit_before_proxying():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        empty_key = await client.post(
            "/api/collections/docs/points/facet",
            json={"key": "   "},
        )
        invalid_limit = await client.post(
            "/api/collections/docs/points/facet",
            json={"key": "category", "limit": 101},
        )

    assert empty_key.status_code == 422
    assert invalid_limit.status_code == 422
    assert fake.calls == []


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
async def test_rest_proxy_returns_safe_upstream_response_metadata():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/rest",
            json={
                "method": "POST",
                "path": "/collections/docs/points/scroll",
                "query": {"consistency": "majority"},
                "body": {"limit": 5},
            },
        )

    assert response.status_code == 200
    assert response.json() == {
        "status_code": 200,
        "headers": {
            "content-type": "application/json",
            "content-length": "27",
        },
        "duration_ms": 1.235,
        "body": {"ok": True, "path": "/collections/docs/points/scroll"},
    }
    assert fake.calls == [
        {
            "method": "POST",
            "path": "/collections/docs/points/scroll",
            "params": {"consistency": "majority"},
            "json": {"limit": 5},
        }
    ]


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
async def test_overwrite_point_payload_maps_to_qdrant_payload_endpoint():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.put(
            "/api/collections/docs/points/payload?wait=true&ordering=medium",
            json={"points": [1], "payload": {"source": "edited", "active": True}},
        )

    assert response.status_code == 200
    assert fake.calls == [
        {
            "method": "PUT",
            "path": "/collections/docs/points/payload",
            "params": {"wait": True, "ordering": "medium"},
            "json": {
                "payload": {"source": "edited", "active": True},
                "points": [1],
            },
        }
    ]


@pytest.mark.anyio
async def test_clear_point_payload_maps_to_qdrant_clear_endpoint():
    fake = RecordingQdrantClient()
    transport = httpx.ASGITransport(app=make_test_app(fake))

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/collections/docs/points/payload/clear?wait=true",
            json={"points": [1, "abc"]},
        )

    assert response.status_code == 200
    assert fake.calls == [
        {
            "method": "POST",
            "path": "/collections/docs/points/payload/clear",
            "params": {"wait": True},
            "json": {"points": [1, "abc"]},
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

    try:
        with pytest.raises(HTTPException) as exc_info:
            await client.request("PUT", "/collections/docs", json={"vectors": {}})
    finally:
        await client.aclose()

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == {
        "message": "Qdrant returned an error.",
        "upstream_status": 409,
        "upstream_body": {"status": "error", "result": {"reason": "exists"}},
    }


@pytest.mark.anyio
async def test_qdrant_client_exposes_success_response_metadata():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/collections"
        return httpx.Response(
            202,
            json={"result": True, "status": "ok"},
            headers={"x-request-id": "request-123"},
        )

    client = QdrantClient(
        Settings(qdrant_url="http://qdrant.local"),
        transport=httpx.MockTransport(handler),
    )
    try:
        response = await client.request_with_metadata("GET", "/collections")
    finally:
        await client.aclose()

    assert response.body == {"result": True, "status": "ok"}
    assert response.status_code == 202
    assert response.headers["x-request-id"] == "request-123"
    assert response.duration_ms >= 0


@pytest.mark.anyio
async def test_qdrant_client_streams_binary_with_api_key():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["api-key"] == "test-qdrant-key"
        assert request.url.path == "/collections/docs/snapshots/test.snapshot"
        return httpx.Response(
            200,
            content=b"binary-snapshot",
            headers={
                "content-type": "application/octet-stream",
                "content-length": "15",
            },
        )

    client = QdrantClient(
        Settings(qdrant_url="http://qdrant.local", qdrant_api_key="test-qdrant-key"),
        transport=httpx.MockTransport(handler),
    )
    try:
        stream = await client.stream(
            "GET",
            "/collections/docs/snapshots/test.snapshot",
        )
        body = b"".join([chunk async for chunk in stream.body])
    finally:
        await client.aclose()

    assert body == b"binary-snapshot"
    assert stream.content_type == "application/octet-stream"
    assert stream.content_length == "15"


@pytest.mark.anyio
async def test_qdrant_client_reuses_request_pool_until_closed():
    request_count = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        return httpx.Response(200, json={"request": request_count})

    client = QdrantClient(
        Settings(qdrant_url="http://qdrant.local"),
        transport=httpx.MockTransport(handler),
    )
    try:
        assert await client.request("GET", "/") == {"request": 1}
        request_client = client._request_client
        assert request_client is not None
        assert await client.request("GET", "/collections") == {"request": 2}
        assert client._request_client is request_client
        assert not request_client.is_closed
    finally:
        await client.aclose()

    assert request_client.is_closed


@pytest.mark.anyio
async def test_app_lifespan_provides_and_closes_shared_qdrant_client():
    app = create_app()

    async with app.router.lifespan_context(app):
        request = Request({"type": "http", "app": app})
        shared_client = get_qdrant_client(request)
        assert shared_client is app.state.qdrant_client
        request_client = shared_client._get_request_client()
        assert not request_client.is_closed

    assert request_client.is_closed
