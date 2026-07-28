import asyncio

import httpx
import pytest

from app.config import Settings
from app.solr import SolrClient


def test_public_urls_redact_configured_userinfo():
    client = SolrClient(
        Settings(
            _env_file=None,
            solr_url="https://operator:secret@search.example:9443/solr/",
        )
    )

    assert client.endpoint == "https://search.example:9443/solr"
    assert client.admin_url == "https://search.example:9443/solr/#/"


@pytest.mark.anyio
async def test_schema_discovers_dense_and_text_fields():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/schema/fields"):
            return httpx.Response(
                200,
                json={
                    "fields": [
                        {"name": "id", "type": "string", "stored": True},
                        {"name": "title", "type": "text_general", "stored": True},
                        {"name": "embedding", "type": "knn_vector", "stored": False},
                    ]
                },
            )
        if request.url.path.endswith("/schema/fieldtypes"):
            return httpx.Response(
                200,
                json={
                    "fieldTypes": [
                        {"name": "string", "class": "solr.StrField"},
                        {"name": "text_general", "class": "solr.TextField"},
                        {
                            "name": "knn_vector",
                            "class": "solr.DenseVectorField",
                            "vectorDimension": "384",
                            "similarityFunction": "dot_product",
                        },
                    ]
                },
            )
        return httpx.Response(
            200,
            json={"uniqueKey": "id"},
        )

    client = SolrClient(
        Settings(_env_file=None),
        transport=httpx.MockTransport(handler),
    )
    schema = await client.collection_schema("docs")
    await client.aclose()

    assert [field["name"] for field in schema["text_fields"]] == ["id", "title"]
    assert schema["unique_key"] == "id"
    assert schema["vector_fields"][0] == {
        "name": "embedding",
        "type": "knn_vector",
        "class": "solr.DenseVectorField",
        "indexed": True,
        "stored": False,
        "required": False,
        "dimension": 384,
        "similarity_function": "dot_product",
        "vector_encoding": "FLOAT32",
    }


@pytest.mark.anyio
async def test_schema_cache_coalesces_requests_and_returns_safe_copies():
    request_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        if request.url.path.endswith("/schema/fields"):
            return httpx.Response(
                200,
                json={"fields": [{"name": "id", "type": "string", "stored": True}]},
            )
        if request.url.path.endswith("/schema/fieldtypes"):
            return httpx.Response(
                200,
                json={"fieldTypes": [{"name": "string", "class": "solr.StrField"}]},
            )
        return httpx.Response(
            200,
            json={"uniqueKey": "id"},
        )

    client = SolrClient(
        Settings(_env_file=None, solr_metadata_cache_ttl_seconds=30),
        transport=httpx.MockTransport(handler),
    )
    schemas = await asyncio.gather(*(client.collection_schema("docs") for _ in range(6)))
    assert request_count == 3

    schemas[0]["fields"].clear()
    cached = await client.collection_schema("docs")
    assert [field["name"] for field in cached["fields"]] == ["id"]
    assert request_count == 3

    client.invalidate_metadata_cache("docs")
    await client.collection_schema("docs")
    await client.aclose()
    assert request_count == 6


@pytest.mark.anyio
async def test_metadata_cache_can_be_disabled():
    request_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        if request.url.path.endswith("/schema/fields"):
            return httpx.Response(200, json={"fields": []})
        if request.url.path.endswith("/schema/fieldtypes"):
            return httpx.Response(200, json={"fieldTypes": []})
        return httpx.Response(200, json={"uniqueKey": "id"})

    client = SolrClient(
        Settings(_env_file=None, solr_metadata_cache_ttl_seconds=0),
        transport=httpx.MockTransport(handler),
    )
    await client.collection_schema("docs")
    await client.collection_schema("docs")
    await client.aclose()

    assert request_count == 6


@pytest.mark.anyio
async def test_schema_cache_refreshes_after_ttl(monkeypatch):
    request_count = 0
    now = 100.0
    monkeypatch.setattr("app.solr.monotonic", lambda: now)

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        if request.url.path.endswith("/schema/fields"):
            return httpx.Response(200, json={"fields": []})
        if request.url.path.endswith("/schema/fieldtypes"):
            return httpx.Response(200, json={"fieldTypes": []})
        return httpx.Response(200, json={"uniqueKey": "id"})

    client = SolrClient(
        Settings(_env_file=None, solr_metadata_cache_ttl_seconds=10),
        transport=httpx.MockTransport(handler),
    )
    await client.collection_schema("docs")
    await client.collection_schema("docs")
    assert request_count == 3

    now = 111.0
    await client.collection_schema("docs")
    await client.aclose()

    assert request_count == 6


@pytest.mark.anyio
async def test_solr_error_shape_and_basic_auth():
    seen_authorization = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal seen_authorization
        seen_authorization = request.headers.get("authorization")
        return httpx.Response(400, json={"error": {"msg": "bad query"}})

    client = SolrClient(
        Settings(_env_file=None, solr_username="admin", solr_password="secret"),
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(Exception) as caught:
        await client.request("GET", "/admin/info/system")
    await client.aclose()

    assert caught.value.status_code == 400
    assert caught.value.detail["upstream_body"] == {"error": {"msg": "bad query"}}
    assert seen_authorization and seen_authorization.startswith("Basic ")
    assert "secret" not in str(caught.value.detail)


@pytest.mark.anyio
async def test_solr_timeout_has_a_distinct_gateway_timeout_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("upstream stalled", request=request)

    client = SolrClient(
        Settings(_env_file=None),
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(Exception) as caught:
        await client.request_with_metadata(
            "POST",
            "/docs/select",
            data={"q": "*:*"},
            timeout_seconds=2,
        )
    await client.aclose()

    assert caught.value.status_code == 504
    assert caught.value.detail["message"] == "Solr query timed out."
    assert caught.value.detail["upstream_status"] is None
