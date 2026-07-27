from types import SimpleNamespace

import pytest

from app.models import SearchCompareRequest, SearchFuseRequest, SearchRequest
from app.routers.search import _weighted_rrf, compare_search, fuse_search, search


class FakeEmbeddings:
    dimension = 384
    model_name = "sentence-transformers/all-MiniLM-L6-v2"
    ready = True

    def status(self):
        return {"status": "ready" if self.ready else "not_loaded"}

    async def load(self):
        self.load_calls = getattr(self, "load_calls", 0) + 1
        self.ready = True
        return self.status()

    async def encode(self, texts):
        assert texts
        self.calls = getattr(self, "calls", 0) + 1
        return [[0.5] * 384], 4.25

    async def encode_query(self, text):
        vectors, elapsed_ms = await self.encode([text])
        return vectors[0], elapsed_ms, False


class FakeSolr:
    def __init__(self):
        self.form = None
        self.forms = []
        self.metadata_timeouts = []

    async def list_collection_names(self, **kwargs):
        self.metadata_timeouts.append(kwargs.get("timeout_seconds"))
        return ["docs"]

    async def collection_schema(self, collection, **kwargs):
        self.metadata_timeouts.append(kwargs.get("timeout_seconds"))
        return {
            "unique_key": "id",
            "fields": [
                {"name": "id"},
                {"name": "title"},
                {"name": "body"},
                {"name": "embedding"},
            ],
            "vector_fields": [
                {"name": "embedding", "dimension": 384, "vector_encoding": "FLOAT32"},
                {"name": "embedding_title", "dimension": 384, "vector_encoding": "FLOAT32"},
            ],
        }

    async def request_with_metadata(self, method, path, *, data, timeout_seconds=None):
        self.form = data
        self.forms.append(data)
        self.timeout_seconds = timeout_seconds
        return SimpleNamespace(
            body={"response": {"numFound": 1, "docs": [{"id": "1", "score": 0.9}]}},
            duration_ms=3.5,
        )


@pytest.mark.anyio
async def test_semantic_search_maps_limit_to_top_k():
    solr = FakeSolr()
    result = await search(
        SearchRequest(
            collection="docs",
            text="schema migrations",
            vector_field="embedding",
            limit=7,
            return_fields=["id", "title"],
        ),
        solr=solr,
        embeddings=FakeEmbeddings(),
    )
    form = solr.form
    assert form["rows"] == 7
    assert "topK=7" in form["q"]
    assert form["fl"] == "id,title,score"
    assert form["echoParams"] == "none"
    assert form["timeAllowed"] == 15_000
    assert solr.timeout_seconds == 16
    assert solr.metadata_timeouts == [16, 16]
    assert result["collection"] == "docs"
    assert result["vector_field"] == "embedding"
    assert result["timings"]["embedding_ms"] == 4.25
    assert result["timings"]["cold_start"] is False
    assert result["timings"]["embedding_cache_hit"] is False
    assert result["timings"]["schema_ms"] >= 0
    assert result["timings"]["model_load_ms"] >= 0
    assert result["timings"]["solr_ms"] >= 0


@pytest.mark.anyio
async def test_hybrid_search_builds_edismax_and_rerank_controls():
    solr = FakeSolr()
    await search(
        SearchRequest(
            collection="docs",
            mode="hybrid",
            text="schema migrations",
            vector_field="embedding",
            lexical_fields=["title", "body"],
            lexical_boosts={"title": 3, "body": 0.75},
            limit=10,
            vector_candidates=250,
            rerank_docs=80,
            rerank_weight=2.5,
            filters=["type:guide"],
        ),
        solr=solr,
        embeddings=FakeEmbeddings(),
    )
    form = solr.form
    assert form["defType"] == "edismax"
    assert form["qf"] == "title^3 body^0.75"
    assert "topK=250" in form["rqq"]
    assert "preFilter=$knnFilter" in form["rqq"]
    assert "reRankDocs=80" in form["rq"] and "reRankWeight=2.5" in form["rq"]
    assert form["fq"] == ["type:guide"]
    assert form["knnFilter"] == ["type:guide"]


@pytest.mark.anyio
async def test_hybrid_rrf_search_runs_vector_and_lexical_retrieval_in_parallel():
    solr = FakeSolr()
    result = await search(
        SearchRequest(
            collection="docs",
            mode="hybrid",
            hybrid_strategy="rrf",
            text="schema migrations",
            vector_field="embedding",
            lexical_fields=["title", "body"],
            lexical_boosts={"title": 3, "body": 1},
            vector_candidates=40,
            lexical_candidates=30,
            vector_weight=2,
            lexical_weight=1,
            hybrid_rrf_k=50,
            limit=5,
            return_fields=["title"],
        ),
        solr=solr,
        embeddings=FakeEmbeddings(),
    )

    assert len(solr.forms) == 2
    vector_form = next(form for form in solr.forms if str(form["q"]).startswith("{!knn"))
    lexical_form = next(form for form in solr.forms if form.get("defType") == "edismax")
    assert vector_form["rows"] == 40
    assert "rq" not in vector_form
    assert lexical_form["rows"] == 30
    assert lexical_form["qf"] == "title^3 body^1"
    assert result["fusion_method"] == "weighted_rrf"
    assert result["source_weights"] == {"embedding": 2.0, "BM25": 1.0}
    assert result["rrf_k"] == 50
    assert result["response"]["response"]["docs"][0]["_fusion"]["ranks"] == {
        "embedding": 1,
        "BM25": 1,
    }


@pytest.mark.anyio
async def test_hybrid_rrf_preserves_all_stored_fields_when_return_fields_are_empty():
    solr = FakeSolr()
    await search(
        SearchRequest(
            collection="docs",
            mode="hybrid",
            hybrid_strategy="rrf",
            text="schema migrations",
            vector_field="embedding",
            lexical_fields=["title"],
            return_fields=[],
        ),
        solr=solr,
        embeddings=FakeEmbeddings(),
    )

    assert all(form["fl"] == "*,score,_fusion_id:id" for form in solr.forms)


@pytest.mark.anyio
async def test_hybrid_rrf_skips_zero_weight_single_search_sources():
    solr = FakeSolr()
    embeddings = FakeEmbeddings()
    result = await search(
        SearchRequest(
            collection="docs",
            mode="hybrid",
            hybrid_strategy="rrf",
            text="schema migrations",
            vector_field="embedding",
            lexical_fields=["title"],
            vector_weight=0,
            lexical_weight=1,
        ),
        solr=solr,
        embeddings=embeddings,
    )

    assert len(solr.forms) == 1
    assert getattr(embeddings, "calls", 0) == 0
    assert solr.forms[0]["defType"] == "edismax"
    assert [item["status"] for item in result["field_results"]] == ["skipped", "ok"]
    assert result["field_results"][0]["reason"] == "Fusion weight is zero."
    assert result["field_results"][1]["returned"] == 1
    assert result["field_results"][1]["num_found"] == 1
    assert result["field_results"][1]["score_samples"] == [0.9]
    assert "response" not in result["field_results"][1]
    assert result["response"]["response"]["docs"][0]["_fusion"]["ranks"] == {"BM25": 1}
    assert result["timings"]["model_load_ms"] == 0
    assert result["timings"]["embedding_ms"] == 0


@pytest.mark.anyio
async def test_semantic_search_uses_native_similarity_threshold():
    solr = FakeSolr()
    await search(
        SearchRequest(
            collection="docs",
            text="schema migrations",
            vector_field="embedding",
            limit=7,
            min_score=0.72,
        ),
        solr=solr,
        embeddings=FakeEmbeddings(),
    )

    assert "{!vectorSimilarity f=embedding minReturn=0.72}" in solr.form["q"]
    assert "topK=" not in solr.form["q"]
    assert solr.form["rows"] == 7


@pytest.mark.anyio
async def test_hybrid_threshold_preserves_vector_prefilter():
    solr = FakeSolr()
    await search(
        SearchRequest(
            collection="docs",
            mode="hybrid",
            text="schema migrations",
            vector_field="embedding",
            lexical_fields=["title"],
            min_score=0.7,
            filters=["type:guide"],
        ),
        solr=solr,
        embeddings=FakeEmbeddings(),
    )

    assert (
        "{!vectorSimilarity f=embedding minReturn=0.7 preFilter=$knnFilter}"
        in solr.form["rqq"]
    )
    assert solr.form["knnFilter"] == ["type:guide"]


@pytest.mark.anyio
async def test_compare_search_embeds_once_and_queries_each_vector_field():
    solr = FakeSolr()
    embeddings = FakeEmbeddings()
    result = await compare_search(
        SearchCompareRequest(
            collection="docs",
            text="schema migrations",
            vector_fields=["embedding", "embedding_title"],
            limit=5,
            return_fields=["id", "title"],
        ),
        solr=solr,
        embeddings=embeddings,
    )

    assert embeddings.calls == 1
    assert result["vector_fields"] == ["embedding", "embedding_title"]
    assert [item["status"] for item in result["results"]] == ["ok", "ok"]
    assert [item["vector_field"] for item in result["results"]] == ["embedding", "embedding_title"]
    assert result["timings"]["cold_start"] is False
    assert result["timings"]["solr_ms"] >= 0


@pytest.mark.anyio
async def test_compare_search_applies_minimum_scores_per_vector_field():
    solr = FakeSolr()
    result = await compare_search(
        SearchCompareRequest(
            collection="docs",
            text="schema migrations",
            vector_fields=["embedding", "embedding_title"],
            vector_min_scores={"embedding": 0.72},
            limit=5,
        ),
        solr=solr,
        embeddings=FakeEmbeddings(),
    )

    queries = [form["q"] for form in solr.forms]
    assert any(
        "{!vectorSimilarity f=embedding minReturn=0.72}" in query
        for query in queries
    )
    assert any("{!knn f=embedding_title topK=5}" in query for query in queries)
    assert result["vector_min_scores"] == {"embedding": 0.72}


def test_compare_search_requires_distinct_vector_fields():
    with pytest.raises(ValueError, match="at least two distinct"):
        SearchCompareRequest(
            collection="docs",
            text="schema migrations",
            vector_fields=["embedding", "embedding"],
        )


def test_compare_search_rejects_minimum_scores_for_unselected_fields():
    with pytest.raises(ValueError, match="unselected vector fields"):
        SearchCompareRequest(
            collection="docs",
            text="schema migrations",
            vector_fields=["embedding", "embedding_title"],
            vector_min_scores={"other": 0.7},
        )


def test_compare_search_supports_more_than_four_vector_fields():
    fields = [f"embedding_{index}" for index in range(8)]
    payload = SearchCompareRequest(
        collection="docs",
        text="schema migrations",
        vector_fields=fields,
    )

    assert payload.vector_fields == fields


def test_weighted_rrf_combines_ranks_and_preserves_source_details():
    field_results = [
        {
            "vector_field": "embedding",
            "status": "ok",
            "response": {"response": {"docs": [{"id": "a", "score": 0.9}, {"id": "b", "score": 0.8}]}},
        },
        {
            "vector_field": "embedding_title",
            "status": "ok",
            "response": {"response": {"docs": [{"id": "b", "score": 0.95}, {"id": "c", "score": 0.7}]}},
        },
    ]

    documents = _weighted_rrf(
        field_results,
        {"embedding": 1.0, "embedding_title": 2.0},
        rrf_k=60,
        limit=3,
    )

    assert [document["id"] for document in documents] == ["b", "c", "a"]
    assert documents[0]["_fusion"]["ranks"] == {"embedding": 2, "embedding_title": 1}
    assert documents[0]["_fusion"]["source_scores"] == {"embedding": 0.8, "embedding_title": 0.95}


def test_weighted_rrf_merges_idless_documents_at_different_ranks():
    shared = {"title": ["Shared result"], "category": ["schema"]}
    field_results = [
        {
            "vector_field": "embedding",
            "status": "ok",
            "response": {
                "response": {
                    "docs": [
                        {"title": ["Other result"], "score": 0.95},
                        {**shared, "score": 0.9},
                    ]
                }
            },
        },
        {
            "vector_field": "embedding_title",
            "status": "ok",
            "response": {"response": {"docs": [{**shared, "score": 0.98}]}},
        },
    ]

    documents = _weighted_rrf(
        field_results,
        {"embedding": 1.0, "embedding_title": 1.0},
        rrf_k=60,
        limit=5,
    )

    shared_documents = [
        document for document in documents if document.get("title") == ["Shared result"]
    ]
    assert len(shared_documents) == 1
    assert shared_documents[0]["_fusion"]["ranks"] == {
        "embedding": 2,
        "embedding_title": 1,
    }
    assert shared_documents[0]["_fusion"]["source_scores"] == {
        "embedding": 0.9,
        "embedding_title": 0.98,
    }


@pytest.mark.anyio
async def test_fuse_search_embeds_once_and_returns_weighted_ranking():
    solr = FakeSolr()
    embeddings = FakeEmbeddings()
    result = await fuse_search(
        SearchFuseRequest(
            collection="docs",
            text="schema migrations",
            vector_fields=["embedding", "embedding_title"],
            vector_weights={"embedding": 1, "embedding_title": 2},
            limit=5,
            fusion_candidates=20,
            return_fields=["id", "title"],
        ),
        solr=solr,
        embeddings=embeddings,
    )

    assert embeddings.calls == 1
    assert result["fusion_method"] == "weighted_rrf"
    assert result["vector_weights"] == {"embedding": 1.0, "embedding_title": 2.0}
    assert result["response"]["response"]["docs"][0]["_fusion"]["ranks"] == {
        "embedding": 1,
        "embedding_title": 1,
    }
    assert "_fusion_id" not in result["response"]["response"]["docs"][0]
    assert "_fusion_id:id" in solr.form["fl"]
    assert all("response" not in item for item in result["field_results"])
    assert all(item["returned"] == 1 for item in result["field_results"])
    assert all(item["score_samples"] == [0.9] for item in result["field_results"])
    assert solr.form["rows"] == 20
    assert result["timings"]["fusion_ms"] >= 0


@pytest.mark.anyio
async def test_hybrid_rrf_fuse_search_adds_one_shared_lexical_source():
    solr = FakeSolr()
    result = await fuse_search(
        SearchFuseRequest(
            collection="docs",
            mode="hybrid",
            hybrid_strategy="rrf",
            text="schema migrations",
            lexical_fields=["title", "body"],
            vector_fields=["embedding", "embedding_title"],
            vector_weights={"embedding": 1, "embedding_title": 2},
            lexical_weight=1.5,
            lexical_candidates=35,
            fusion_candidates=20,
            limit=5,
        ),
        solr=solr,
        embeddings=FakeEmbeddings(),
    )

    assert len(solr.forms) == 3
    assert sum(form.get("defType") == "edismax" for form in solr.forms) == 1
    assert sum(str(form["q"]).startswith("{!knn") for form in solr.forms) == 2
    assert [item["vector_field"] for item in result["field_results"]] == [
        "embedding",
        "embedding_title",
        "BM25",
    ]
    assert result["vector_weights"] == {"embedding": 1.0, "embedding_title": 2.0}
    assert result["source_weights"] == {
        "embedding": 1.0,
        "embedding_title": 2.0,
        "BM25": 1.5,
    }
    assert result["response"]["response"]["docs"][0]["_fusion"]["ranks"] == {
        "embedding": 1,
        "embedding_title": 1,
        "BM25": 1,
    }


@pytest.mark.anyio
async def test_hybrid_rrf_compare_reuses_one_lexical_request():
    solr = FakeSolr()
    result = await compare_search(
        SearchCompareRequest(
            collection="docs",
            mode="hybrid",
            hybrid_strategy="rrf",
            text="schema migrations",
            lexical_fields=["title"],
            vector_fields=["embedding", "embedding_title"],
            vector_candidates=20,
            lexical_candidates=25,
            limit=5,
        ),
        solr=solr,
        embeddings=FakeEmbeddings(),
    )

    assert len(solr.forms) == 3
    assert sum(form.get("defType") == "edismax" for form in solr.forms) == 1
    assert [item["status"] for item in result["results"]] == ["ok", "ok"]
    assert all(
        item["response"]["response"]["docs"][0]["_fusion"]["ranks"]
        == {item["vector_field"]: 1, "BM25": 1}
        for item in result["results"]
    )
    assert all(
        all("response" not in source for source in item["source_results"])
        for item in result["results"]
    )
    assert all(
        [source["returned"] for source in item["source_results"]] == [1, 1]
        for item in result["results"]
    )


@pytest.mark.anyio
async def test_fuse_search_skips_zero_weight_vector_fields():
    solr = FakeSolr()
    result = await fuse_search(
        SearchFuseRequest(
            collection="docs",
            text="schema migrations",
            vector_fields=["embedding", "embedding_title"],
            vector_weights={"embedding": 1, "embedding_title": 0},
            limit=5,
        ),
        solr=solr,
        embeddings=FakeEmbeddings(),
    )

    assert len(solr.forms) == 1
    assert [item["status"] for item in result["field_results"]] == ["ok", "skipped"]
    assert result["field_results"][1]["reason"] == "Fusion weight is zero."


@pytest.mark.anyio
async def test_hybrid_rrf_fuse_skips_embedding_when_all_vector_weights_are_zero():
    solr = FakeSolr()
    embeddings = FakeEmbeddings()
    result = await fuse_search(
        SearchFuseRequest(
            collection="docs",
            mode="hybrid",
            hybrid_strategy="rrf",
            text="schema migrations",
            lexical_fields=["title"],
            vector_fields=["embedding", "embedding_title"],
            vector_weights={"embedding": 0, "embedding_title": 0},
            lexical_weight=1,
            limit=5,
        ),
        solr=solr,
        embeddings=embeddings,
    )

    assert getattr(embeddings, "calls", 0) == 0
    assert len(solr.forms) == 1
    assert solr.forms[0]["defType"] == "edismax"
    assert [item["status"] for item in result["field_results"]] == [
        "skipped",
        "skipped",
        "ok",
    ]
    assert result["timings"]["model_load_ms"] == 0
    assert result["timings"]["embedding_ms"] == 0


@pytest.mark.anyio
async def test_hybrid_rrf_compare_skips_vector_requests_when_vector_weight_is_zero():
    solr = FakeSolr()
    embeddings = FakeEmbeddings()
    result = await compare_search(
        SearchCompareRequest(
            collection="docs",
            mode="hybrid",
            hybrid_strategy="rrf",
            text="schema migrations",
            lexical_fields=["title"],
            vector_fields=["embedding", "embedding_title"],
            vector_weight=0,
            lexical_weight=1,
            limit=5,
        ),
        solr=solr,
        embeddings=embeddings,
    )

    assert getattr(embeddings, "calls", 0) == 0
    assert len(solr.forms) == 1
    assert solr.forms[0]["defType"] == "edismax"
    assert [item["status"] for item in result["results"]] == ["ok", "ok"]
    assert all(
        [source["status"] for source in item["source_results"]] == ["skipped", "ok"]
        for item in result["results"]
    )
    assert all(
        item["response"]["response"]["docs"][0]["_fusion"]["ranks"] == {"BM25": 1}
        for item in result["results"]
    )
    assert result["timings"]["model_load_ms"] == 0
    assert result["timings"]["embedding_ms"] == 0


@pytest.mark.anyio
async def test_search_reports_embedding_model_cold_start():
    embeddings = FakeEmbeddings()
    embeddings.ready = False

    result = await search(
        SearchRequest(
            collection="docs",
            text="schema migrations",
            vector_field="embedding",
        ),
        solr=FakeSolr(),
        embeddings=embeddings,
    )

    assert result["timings"]["cold_start"] is True
    assert result["timings"]["model_load_ms"] >= 0
    assert embeddings.load_calls >= 1


def test_fuse_search_rejects_unknown_weight_fields():
    with pytest.raises(ValueError, match="unselected vector fields"):
        SearchFuseRequest(
            collection="docs",
            text="schema migrations",
            vector_fields=["embedding", "embedding_title"],
            vector_weights={"other": 1},
        )


def test_hybrid_search_rejects_unknown_lexical_boost_fields():
    with pytest.raises(ValueError, match="unselected lexical fields"):
        SearchRequest(
            collection="docs",
            mode="hybrid",
            text="schema migrations",
            vector_field="embedding",
            lexical_fields=["title"],
            lexical_boosts={"body": 2},
        )
