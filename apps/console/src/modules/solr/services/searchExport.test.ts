import type { SearchPayload } from "./api";
import {
  buildSearchEvaluationReport,
  buildSearchExportRows,
  searchExportFilename,
  searchExportRowsToCsv,
  type SearchExecutionMetadata,
} from "./searchExport";

const payload: SearchPayload = {
  collection: "demo docs",
  mode: "semantic",
  hybrid_strategy: "rerank",
  text: 'backup, recovery "guide"',
  vector_field: "embedding",
  lexical_fields: [],
  lexical_boosts: {},
  limit: 2,
  vector_candidates: 100,
  lexical_candidates: 100,
  rerank_docs: 100,
  rerank_weight: 2,
  lexical_weight: 1,
  vector_weight: 1,
  hybrid_rrf_k: 60,
  min_score: null,
  filters: ['category:"backup"'],
  return_fields: ["id", "title", "tags"],
};

const resultSets = [
  {
    vector_field: "embedding",
    documents: [
      { id: "1", title: ["Backup guide"], tags: ["backup", "recovery"], score: 0.9 },
      { id: "2", title: ['Restore "checklist"'], body: "line one\nline two", score: 0.8 },
    ],
  },
  {
    vector_field: "embedding_title",
    documents: [{ id: "2", title: ['Restore "checklist"'], score: 0.85 }],
  },
];

const { vector_field: _vectorField, ...sharedPayload } = payload;
const execution: SearchExecutionMetadata = {
  target_mode: "fuse",
  endpoint: "/api/search/fuse",
  api_body: {
    ...sharedPayload,
    vector_fields: ["embedding", "embedding_title"],
    vector_min_scores: { embedding: 0.7, embedding_title: 0.75 },
    vector_weights: { embedding: 1, embedding_title: 2 },
    fusion_candidates: 50,
    rrf_k: 60,
  },
  solr_requests: [],
  timings: {
    schema_ms: 0.1,
    model_load_ms: 0,
    embedding_ms: 0.01,
    solr_ms: 12,
    fusion_ms: 0.2,
    overhead_ms: 0.1,
    total_ms: 12.41,
    cold_start: false,
    embedding_cache_hit: true,
  },
};

describe("search evaluation export", () => {
  it("flattens ranked result sets and applies shared judgments", () => {
    const rows = buildSearchExportRows(payload, resultSets, {
      "id:1": "relevant",
      "id:2": "irrelevant",
    });

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      vector_field: "embedding",
      rank: 1,
      judgment: "relevant",
      id: "1",
      score: 0.9,
    });
    expect(rows[2]).toMatchObject({
      vector_field: "embedding_title",
      rank: 1,
      judgment: "irrelevant",
      id: "2",
    });
  });

  it("serializes arrays, quotes, commas, and newlines as valid CSV cells", () => {
    const csv = searchExportRowsToCsv(buildSearchExportRows(payload, resultSets, {}));

    expect(csv).toContain('"backup, recovery ""guide"""');
    expect(csv).toContain("backup | recovery");
    expect(csv).toContain('"line one\nline two"');
    expect(csv).toContain('Restore ""checklist""');
  });

  it("builds JSON metrics for overall and per-field judgments", () => {
    const report = buildSearchEvaluationReport(
      payload,
      resultSets,
      { "id:1": "relevant", "id:2": "irrelevant" },
      "2026-07-24T00:00:00.000Z",
    );

    expect(report.exported_at).toBe("2026-07-24T00:00:00.000Z");
    expect(report.evaluation.overall).toEqual({
      total: 2,
      judged: 2,
      relevant: 1,
      irrelevant: 1,
    });
    expect(report.evaluation.by_vector_field.embedding_title).toMatchObject({
      total: 1,
      judged: 1,
      irrelevant: 1,
    });
    expect(report.evaluation.ranking_by_vector_field.embedding).toEqual({
      cutoff: 2,
      judged: 2,
      relevant: 1,
      coverage: 1,
      judged_precision: 0.5,
      reciprocal_rank: 1,
      ndcg: 1,
    });
  });

  it("exports the complete multi-vector execution plan", () => {
    const report = buildSearchEvaluationReport(
      payload,
      resultSets,
      {},
      "2026-07-24T00:00:00.000Z",
      execution,
    );
    const rows = buildSearchExportRows(payload, resultSets, {}, execution);
    const csv = searchExportRowsToCsv(rows);

    expect(report.execution).toEqual(execution);
    expect(report.execution?.api_body).toMatchObject({
      vector_fields: ["embedding", "embedding_title"],
      vector_min_scores: { embedding: 0.7, embedding_title: 0.75 },
      vector_weights: { embedding: 1, embedding_title: 2 },
      fusion_candidates: 50,
      rrf_k: 60,
    });
    expect(rows[0]).toMatchObject({
      target_mode: "fuse",
      endpoint: "/api/search/fuse",
      vector_fields: ["embedding", "embedding_title"],
      total_ms: 12.41,
      embedding_cache_hit: true,
    });
    expect(csv).toContain("embedding | embedding_title");
    expect(csv).toContain('"{""embedding"":0.7,""embedding_title"":0.75}"');
  });

  it("creates a filesystem-safe filename", () => {
    expect(searchExportFilename("demo docs/2026", "csv")).toBe("demo-docs-2026-vector-search.csv");
  });
});
