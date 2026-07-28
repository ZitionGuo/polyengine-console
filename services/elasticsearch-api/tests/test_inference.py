import pytest

from app.routers.inference import inference_endpoints


class FakeClient:
    async def request(self, method: str, path: str):
        assert (method, path) == ("GET", "/_inference/_all")
        return {
            "endpoints": [
                {
                    "inference_id": "text-embeddings",
                    "task_type": "text_embedding",
                    "service": "elasticsearch",
                },
                {
                    "inference_id": "reranker",
                    "task_type": "rerank",
                    "service": "cohere",
                },
            ]
        }


@pytest.mark.anyio
async def test_inference_endpoint_discovery_keeps_text_embeddings():
    result = await inference_endpoints(client=FakeClient())
    assert result == {
        "available": True,
        "endpoints": [
            {
                "id": "text-embeddings",
                "task_type": "text_embedding",
                "service": "elasticsearch",
            }
        ],
    }
