import type { CompareSearchItem, CompareSearchResult, FuseSearchResult, SearchPayload } from "./api";
import {
  buildCompareSearchPayload,
  buildFuseSearchPayload,
  comparisonOverlap,
  fusionFieldDiagnostics,
  sourceReturnedCount,
} from "./comparison";

const payload: SearchPayload = {
  collection: "docs",
  mode: "semantic",
  hybrid_strategy: "rerank",
  text: "schema migrations",
  vector_field: "embedding",
  lexical_fields: [],
  lexical_boosts: {},
  limit: 3,
  vector_candidates: 100,
  lexical_candidates: 100,
  rerank_docs: 100,
  rerank_weight: 2,
  lexical_weight: 1,
  vector_weight: 1,
  hybrid_rrf_k: 60,
  min_score: null,
  filters: [],
  return_fields: ["id", "title"],
};

const compareResult = (results: CompareSearchItem[]): CompareSearchResult => ({
  collection: "docs",
  vector_fields: results.map((item) => item.vector_field),
  vector_min_scores: {},
  mode: "semantic",
  hybrid_strategy: "rerank",
  model: "all-MiniLM-L6-v2",
  dimension: 384,
  embedding_ms: 4,
  total_ms: 12,
  timings: {
    schema_ms: 1,
    model_load_ms: 0,
    embedding_ms: 4,
    solr_ms: 6,
    fusion_ms: 0,
    overhead_ms: 1,
    total_ms: 12,
    cold_start: false,
    embedding_cache_hit: false,
  },
  results,
});

describe("buildCompareSearchPayload", () => {
  it("deduplicates fields and removes the single vector field", () => {
    const { vector_field: _vectorField, ...shared } = payload;
    expect(buildCompareSearchPayload(payload, ["embedding", "embedding_title", "embedding"])).toEqual({
      ...shared,
      min_score: null,
      vector_fields: ["embedding", "embedding_title"],
      vector_min_scores: {},
    });
  });

  it("supports collections with more than four vector fields", () => {
    const fields = Array.from({ length: 8 }, (_, index) => `embedding_${index}`);
    expect(buildCompareSearchPayload(payload, fields).vector_fields).toEqual(fields);
  });

  it("keeps independent minimum scores for selected vector fields", () => {
    const result = buildCompareSearchPayload(
      payload,
      ["embedding", "embedding_title"],
      { embedding: 0.72, embedding_title: null, ignored: 0.9 },
    );

    expect(result.vector_min_scores).toEqual({ embedding: 0.72 });
    expect(result.min_score).toBeNull();
  });
});

describe("buildFuseSearchPayload", () => {
  it("keeps selected field weights and enough candidates for the requested result count", () => {
    expect(
      buildFuseSearchPayload(
        { ...payload, limit: 20 },
        ["embedding", "embedding_title", "embedding"],
        { embedding: 0.5, embedding_title: 2 },
        10,
        60,
      ),
    ).toMatchObject({
      vector_fields: ["embedding", "embedding_title"],
      vector_weights: { embedding: 0.5, embedding_title: 2 },
      fusion_candidates: 20,
      rrf_k: 60,
    });
  });

  it("adds field-specific thresholds to fused requests", () => {
    const result = buildFuseSearchPayload(
      payload,
      ["embedding", "embedding_title"],
      { embedding: 1, embedding_title: 1 },
      50,
      60,
      { embedding: 0.7, embedding_title: 0.8 },
    );

    expect(result.vector_min_scores).toEqual({
      embedding: 0.7,
      embedding_title: 0.8,
    });
  });
});

describe("comparisonOverlap", () => {
  it("calculates shared documents across successful fields", () => {
    const result = compareResult([
        { vector_field: "embedding", status: "ok", response: { response: { docs: [{ id: "1" }, { id: "2" }] } } },
        { vector_field: "embedding_title", status: "ok", response: { response: { docs: [{ id: "2" }, { id: "3" }] } } },
    ]);

    expect(comparisonOverlap(result)).toEqual({ shared: 1, comparable: 2, percentage: 50 });
  });

  it("ignores failed fields and requires two successful result sets", () => {
    const result = compareResult([
        { vector_field: "embedding", status: "ok", response: { response: { docs: [{ id: "1" }] } } },
        { vector_field: "broken", status: "error", error: { message: "failed" } },
    ]);

    expect(comparisonOverlap(result)).toBeNull();
  });
});

describe("fusionFieldDiagnostics", () => {
  it("separates active, failed, and zero-weight fields", () => {
    const result = {
      field_results: [
        { vector_field: "embedding", status: "ok" },
        { vector_field: "embedding_title", status: "error" },
        { vector_field: "embedding_summary", status: "skipped" },
      ],
    } as FuseSearchResult;

    expect(fusionFieldDiagnostics(result)).toEqual({
      active: ["embedding"],
      failed: ["embedding_title"],
      skipped: ["embedding_summary"],
    });
  });
});

describe("sourceReturnedCount", () => {
  it("prefers compact source counts and supports legacy full responses", () => {
    expect(sourceReturnedCount({
      returned: 100,
      response: { response: { docs: [{ id: "only-one" }] } },
    })).toBe(100);
    expect(sourceReturnedCount({
      response: { response: { docs: [{ id: "1" }, { id: "2" }] } },
    })).toBe(2);
    expect(sourceReturnedCount({})).toBe(0);
  });
});
