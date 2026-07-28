from dataclasses import dataclass
from typing import Any

import pytest

from app.elasticsearch import ElasticsearchHttpResponse
from app.models import SearchRequest
from app.routers.search import LEXICAL_SOURCE, _weighted_rrf, search


MAPPING = {
    "articles": {
        "mappings": {
            "properties": {
                "title": {"type": "text"},
                "content": {"type": "text"},
                "title_embedding": {"type": "dense_vector", "dims": 384},
                "content_embedding": {"type": "dense_vector", "dims": 384},
                "semantic_content": {
                    "type": "semantic_text",
                    "search_inference_id": "semantic-endpoint",
                },
            }
        }
    }
}


@dataclass
class FakeEmbeddings:
    dimension: int = 384
    model_name: str = "Qwen/Qwen3-Embedding-0.6B"

    async def encode_query(self, text: str):
        return [0.25] * self.dimension, 12.5, False


class FakeClient:
    def __init__(self):
        self.search_bodies: list[dict[str, Any]] = []

    async def request(self, method: str, path: str, **kwargs):
        assert method == "GET"
        assert path == "/articles/_mapping"
        return MAPPING

    async def request_with_metadata(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any],
        **kwargs,
    ):
        self.search_bodies.append(json_body)
        source = (
            "bm25"
            if json_body.get("query", {}).get("multi_match")
            or json_body.get("query", {}).get("bool", {}).get("must")
            else json_body.get("query", {}).get("knn", {}).get("field", "native")
        )
        hits = [
            {
                "_index": "articles",
                "_id": f"{source}-1",
                "_score": 2.0,
                "_source": {"title": source},
            }
        ]
        if source == "bm25":
            hits.append(
                {
                    "_index": "articles",
                    "_id": "title_embedding-1",
                    "_score": 1.1,
                    "_source": {"title": "overlap"},
                }
            )
        return ElasticsearchHttpResponse(
            body={
                "took": 4,
                "timed_out": False,
                "_shards": {"successful": 1, "failed": 0},
                "hits": {"total": {"value": len(hits)}, "hits": hits},
            },
            duration_ms=5.0,
            status_code=200,
        )


def payload(**overrides):
    data = {
        "index": "articles",
        "text": "vector search",
        "vector_targets": [{"field": "title_embedding"}],
        "source_fields": ["title"],
        "top_k": 5,
    }
    data.update(overrides)
    return SearchRequest.model_validate(data)


@pytest.mark.anyio
async def test_local_search_builds_query_vector_and_candidate_controls():
    client = FakeClient()
    result = await search(payload(num_candidates=55), client=client, embeddings=FakeEmbeddings())

    knn = client.search_bodies[0]["query"]["knn"]
    assert knn["field"] == "title_embedding"
    assert len(knn["query_vector"]) == 384
    assert knn["num_candidates"] == 55
    assert result["model"] == "Qwen/Qwen3-Embedding-0.6B"
    assert result["dimension"] == 384


@pytest.mark.anyio
async def test_fusion_candidates_never_drop_below_rank_window():
    client = FakeClient()
    request = payload(
        result_mode="fuse",
        vector_targets=[
            {"field": "title_embedding"},
            {"field": "content_embedding"},
        ],
        num_candidates=20,
        rank_window_size=80,
    )
    await search(request, client=client, embeddings=FakeEmbeddings())

    assert all(body["query"]["knn"]["k"] == 80 for body in client.search_bodies)
    assert all(body["query"]["knn"]["num_candidates"] == 80 for body in client.search_bodies)


@pytest.mark.anyio
async def test_field_native_search_uses_semantic_text_query_builder():
    client = FakeClient()
    request = payload(
        vector_targets=[
            {"field": "semantic_content", "provider": "field_native"}
        ]
    )
    await search(request, client=client, embeddings=FakeEmbeddings())

    builder = client.search_bodies[0]["query"]["knn"]["query_vector_builder"]["text_embedding"]
    assert builder == {"model_text": "vector search"}


@pytest.mark.anyio
async def test_inference_provider_includes_selected_endpoint():
    client = FakeClient()
    request = payload(
        vector_targets=[
            {
                "field": "title_embedding",
                "provider": "inference",
                "inference_id": "my-qwen-endpoint",
            }
        ]
    )
    await search(request, client=client, embeddings=FakeEmbeddings())

    builder = client.search_bodies[0]["query"]["knn"]["query_vector_builder"]["text_embedding"]
    assert builder["model_id"] == "my-qwen-endpoint"


@pytest.mark.anyio
async def test_hybrid_fuse_runs_vector_and_bm25_with_weighted_rrf():
    client = FakeClient()
    request = payload(
        mode="hybrid",
        result_mode="fuse",
        vector_targets=[
            {"field": "title_embedding", "weight": 2},
            {"field": "content_embedding", "weight": 1},
        ],
        lexical_fields=[{"field": "title", "boost": 2}, {"field": "content"}],
        lexical_weight=1.5,
    )
    result = await search(request, client=client, embeddings=FakeEmbeddings())

    assert len(client.search_bodies) == 3
    assert result["fusion_backend"] == "application"
    assert {item["source"] for item in result["source_results"]} == {
        "title_embedding",
        "content_embedding",
        LEXICAL_SOURCE,
    }
    assert result["hits"][0]["_fusion"]["method"] == "weighted_rrf"


@pytest.mark.anyio
async def test_native_rrf_builds_weighted_retrievers():
    client = FakeClient()
    request = payload(
        result_mode="fuse",
        fusion_backend="elasticsearch",
        vector_targets=[
            {"field": "title_embedding", "weight": 2},
            {"field": "content_embedding", "weight": 1},
        ],
    )
    result = await search(request, client=client, embeddings=FakeEmbeddings())

    rrf = client.search_bodies[0]["retriever"]["rrf"]
    assert rrf["retrievers"][0]["weight"] == 2
    assert rrf["retrievers"][0]["retriever"]["knn"]["field"] == "title_embedding"
    assert rrf["retrievers"][1]["knn"]["field"] == "content_embedding"
    assert result["fusion_backend"] == "elasticsearch"


def test_weighted_rrf_exposes_source_contributions():
    sources = [
        {
            "source": "title",
            "status": "ok",
            "hits": [{"_index": "i", "_id": "1", "_score": 4.0}],
        },
        {
            "source": "body",
            "status": "ok",
            "hits": [{"_index": "i", "_id": "1", "_score": 3.0}],
        },
    ]
    hits = _weighted_rrf(
        sources,
        {"title": 2, "body": 1},
        rank_constant=60,
        limit=10,
    )

    assert hits[0]["_id"] == "1"
    assert set(hits[0]["_fusion"]["contributions"]) == {"title", "body"}
