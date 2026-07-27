import type { SearchPayload } from "./api";
import { buildQueryRequestPreview } from "./queryPreview";

const payload: SearchPayload = {
  collection: "demo docs",
  mode: "semantic",
  hybrid_strategy: "rerank",
  text: "backup recovery",
  vector_field: "embedding",
  lexical_fields: [],
  lexical_boosts: {},
  limit: 12,
  vector_candidates: 100,
  lexical_candidates: 100,
  rerank_docs: 100,
  rerank_weight: 2,
  lexical_weight: 1,
  vector_weight: 1,
  hybrid_rrf_k: 60,
  timeout_ms: 2_500,
  min_score: null,
  filters: ['category:"backup"'],
  return_fields: ["id", "title"],
};

describe("buildQueryRequestPreview", () => {
  it("previews a semantic KNN request without exposing the vector", () => {
    const preview = buildQueryRequestPreview(payload, ["embedding"]);

    expect(preview.endpoint).toBe("/api/search");
    expect(preview.solr_requests[0]).toMatchObject({
      vector_field: "embedding",
      path: "/demo%20docs/select",
      params: {
        rows: 12,
        fl: "id,title,score",
        timeAllowed: 2_500,
        q: "{!knn f=embedding topK=12}<384-dimensional-query-vector>",
        fq: ['category:"backup"'],
      },
    });
    expect(JSON.stringify(preview)).not.toContain("[0.");
  });

  it("builds a compare API body and one Solr template per vector field", () => {
    const preview = buildQueryRequestPreview(payload, ["embedding", "embedding_title"]);

    expect(preview.endpoint).toBe("/api/search/compare");
    expect(preview.api_body).not.toHaveProperty("vector_field");
    expect(preview.api_body).toHaveProperty("vector_fields", ["embedding", "embedding_title"]);
    expect(preview.solr_requests.map((request) => request.vector_field)).toEqual([
      "embedding",
      "embedding_title",
    ]);
  });

  it("previews Solr native similarity threshold queries", () => {
    const preview = buildQueryRequestPreview(
      { ...payload, min_score: 0.72 },
      ["embedding"],
    );

    expect(preview.solr_requests[0].params.q).toBe(
      "{!vectorSimilarity f=embedding minReturn=0.72}<384-dimensional-query-vector>",
    );
  });

  it("builds a fused request with weighted fields and a larger candidate pool", () => {
    const preview = buildQueryRequestPreview(
      payload,
      ["embedding", "embedding_title"],
      "fuse",
      {
        vectorWeights: { embedding: 1, embedding_title: 2 },
        fusionCandidates: 50,
        rrfK: 60,
      },
    );

    expect(preview.endpoint).toBe("/api/search/fuse");
    expect(preview.api_body).toMatchObject({
      vector_fields: ["embedding", "embedding_title"],
      vector_weights: { embedding: 1, embedding_title: 2 },
      fusion_candidates: 50,
      rrf_k: 60,
    });
    expect(preview.solr_requests[0].params.rows).toBe(50);
    expect(preview.solr_requests[0].params.q).toContain("topK=50");
  });

  it("previews hybrid eDisMax, rerank, and filtered KNN parameters", () => {
    const preview = buildQueryRequestPreview(
      {
        ...payload,
        mode: "hybrid",
        lexical_fields: ["title", "body"],
        lexical_boosts: { title: 3, body: 1 },
        limit: 20,
        vector_candidates: 10,
        rerank_docs: 5,
        rerank_weight: 2.5,
      },
      ["embedding"],
    );
    const params = preview.solr_requests[0].params;

    expect(params.defType).toBe("edismax");
    expect(params.qf).toBe("title^3 body^1");
    expect(params.rq).toContain("reRankDocs=20 reRankWeight=2.5");
    expect(params.rqq).toContain("topK=20 preFilter=$knnFilter");
    expect(params.knnFilter).toEqual(['category:"backup"']);
  });

  it("previews parallel hybrid RRF as vector and BM25 requests", () => {
    const preview = buildQueryRequestPreview(
      {
        ...payload,
        mode: "hybrid",
        hybrid_strategy: "rrf",
        lexical_fields: ["title", "body"],
        lexical_boosts: { title: 3, body: 1 },
        vector_candidates: 40,
        lexical_candidates: 30,
      },
      ["embedding"],
      "single",
    );

    expect(preview.solr_requests).toHaveLength(2);
    expect(preview.solr_requests[0]).toMatchObject({
      vector_field: "embedding",
      params: {
        rows: 40,
        q: "{!knn f=embedding topK=40}<384-dimensional-query-vector>",
        fq: ['category:"backup"'],
      },
    });
    expect(preview.solr_requests[1]).toMatchObject({
      vector_field: "BM25",
      params: {
        rows: 30,
        q: "backup recovery",
        defType: "edismax",
        qf: "title^3 body^1",
        fq: ['category:"backup"'],
      },
    });
    expect(preview.solr_requests[1].params).not.toHaveProperty("rq");
  });

  it("omits zero-weight RRF sources from the execution preview", () => {
    const single = buildQueryRequestPreview(
      {
        ...payload,
        mode: "hybrid",
        hybrid_strategy: "rrf",
        lexical_fields: ["title"],
        vector_weight: 0,
      },
      ["embedding"],
      "single",
    );
    expect(single.solr_requests.map((request) => request.vector_field)).toEqual(["BM25"]);

    const fused = buildQueryRequestPreview(
      {
        ...payload,
        mode: "hybrid",
        hybrid_strategy: "rrf",
        lexical_fields: ["title"],
        lexical_weight: 0,
      },
      ["embedding", "embedding_title"],
      "fuse",
      {
        vectorWeights: { embedding: 1, embedding_title: 0 },
        fusionCandidates: 50,
        rrfK: 60,
      },
    );
    expect(fused.solr_requests.map((request) => request.vector_field)).toEqual(["embedding"]);
  });
});
