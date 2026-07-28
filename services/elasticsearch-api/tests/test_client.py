import httpx
import pytest
from fastapi import HTTPException

from app.config import Settings
from app.elasticsearch import ElasticsearchClient


@pytest.mark.anyio
async def test_client_injects_api_key_and_normalizes_upstream_error():
    async def handler(request: httpx.Request):
        assert request.headers["Authorization"] == "ApiKey secret"
        return httpx.Response(
            400,
            json={"error": {"root_cause": [{"reason": "bad query"}]}},
        )

    settings = Settings(
        elasticsearch_url="http://elasticsearch:9200",
        elasticsearch_api_key="secret",
    )
    client = ElasticsearchClient(settings, transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(HTTPException) as exc_info:
            await client.request("GET", "/broken")
    finally:
        await client.aclose()

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["message"] == "bad query"
    assert exc_info.value.detail["upstream_status"] == 400


@pytest.mark.parametrize(
    "path",
    ["https://example.com/_search", "//example.com/_search", "_search"],
)
def test_client_rejects_non_relative_paths(path: str):
    with pytest.raises(HTTPException):
        ElasticsearchClient.validate_path(path)
