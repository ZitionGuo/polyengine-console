import type { SearchPayload } from "./api";
import {
  clearRelevanceJudgments,
  documentJudgmentKey,
  loadRelevanceJudgments,
  relevanceContext,
  rankingMetrics,
  relevanceStats,
  updateRelevanceJudgment,
} from "./relevance";

const payload: SearchPayload = {
  collection: "docs",
  mode: "semantic",
  hybrid_strategy: "rerank",
  text: "  Backup Recovery ",
  vector_field: "embedding",
  lexical_fields: [],
  lexical_boosts: {},
  limit: 10,
  vector_candidates: 100,
  lexical_candidates: 100,
  rerank_docs: 100,
  rerank_weight: 2,
  lexical_weight: 1,
  vector_weight: 1,
  hybrid_rrf_k: 60,
  min_score: null,
  filters: ['category:"backup"'],
  return_fields: ["id", "title"],
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("relevance judgments", () => {
  it("shares a context across vector fields and topK values", () => {
    const alternative = {
      ...payload,
      vector_field: "embedding_title",
      limit: 50,
    };
    expect(relevanceContext(alternative)).toBe(relevanceContext(payload));
  });

  it("stores, toggles, and clears query-scoped judgments", () => {
    const context = relevanceContext(payload);
    expect(updateRelevanceJudgment(context, "id:1", "relevant")).toEqual({ "id:1": "relevant" });
    expect(updateRelevanceJudgment(context, "id:2", "irrelevant")).toEqual({
      "id:1": "relevant",
      "id:2": "irrelevant",
    });
    expect(updateRelevanceJudgment(context, "id:1")).toEqual({ "id:2": "irrelevant" });
    expect(loadRelevanceJudgments(context)).toEqual({ "id:2": "irrelevant" });
    expect(clearRelevanceJudgments(context)).toEqual({});
    expect(loadRelevanceJudgments(context)).toEqual({});
  });

  it("uses ids when available and stable document content otherwise", () => {
    expect(documentJudgmentKey({ id: "doc-1", score: 0.8 })).toBe("id:doc-1");
    expect(documentJudgmentKey({ title: "Guide", score: 0.8, category: "docs" }))
      .toBe(documentJudgmentKey({ category: "docs", score: 0.7, title: "Guide" }));
  });

  it("calculates unique judged and relevant result counts", () => {
    const documents = [{ id: "1" }, { id: "2" }, { id: "1" }, { id: "3" }];
    expect(relevanceStats(documents, { "id:1": "relevant", "id:2": "irrelevant" })).toEqual({
      total: 3,
      judged: 2,
      relevant: 1,
      irrelevant: 1,
    });
  });

  it("calculates ranking-aware metrics from relevance judgments", () => {
    const documents = [{ id: "1" }, { id: "2" }, { id: "3" }];
    expect(
      rankingMetrics(documents, {
        "id:1": "relevant",
        "id:2": "irrelevant",
        "id:3": "relevant",
      }),
    ).toEqual({
      cutoff: 3,
      judged: 3,
      relevant: 2,
      coverage: 1,
      judged_precision: 0.6667,
      reciprocal_rank: 1,
      ndcg: 0.9197,
    });
  });

  it("reports partial judgment coverage without treating it as low precision", () => {
    const metrics = rankingMetrics(
      [{ id: "1" }, { id: "2" }, { id: "3" }],
      { "id:2": "relevant" },
    );

    expect(metrics.coverage).toBe(0.3333);
    expect(metrics.judged_precision).toBe(1);
    expect(metrics.reciprocal_rank).toBe(0.5);
    expect(metrics.ndcg).toBe(0.6309);
  });
});
