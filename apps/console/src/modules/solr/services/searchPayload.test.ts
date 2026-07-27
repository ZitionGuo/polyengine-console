import {
  buildSearchPayload,
  clearSearchHistory,
  loadSearchHistory,
  removeSearchHistory,
  saveSearchHistory,
  searchPayloadToFormValues,
} from "./searchPayload";

const historyKey = "solr-vector-search-history";

beforeEach(() => {
  window.localStorage.clear();
});

describe("buildSearchPayload", () => {
  it("maps semantic result count to a clean request", () => {
    expect(
      buildSearchPayload({
        collection: "docs",
        mode: "semantic",
        text: "  zero downtime migrations  ",
        vector_field: "embedding",
        lexical_fields: ["title"],
        limit: 12,
        filters: "type:guide\n\nstatus:published",
      }),
    ).toEqual({
      collection: "docs",
      mode: "semantic",
      hybrid_strategy: "rerank",
      text: "zero downtime migrations",
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
      timeout_ms: 15_000,
      min_score: null,
      filters: ["type:guide", "status:published"],
      return_fields: [],
    });
  });

  it("keeps hybrid RRF retrieval controls", () => {
    const payload = buildSearchPayload({
      collection: "docs",
      mode: "hybrid",
      hybrid_strategy: "rrf",
      text: "schema design",
      vector_field: "embedding",
      lexical_fields: ["title", "body"],
      vector_candidates: 80,
      lexical_candidates: 60,
      lexical_weight: 1.5,
      vector_weight: 2,
      hybrid_rrf_k: 40,
    });

    expect(payload).toMatchObject({
      hybrid_strategy: "rrf",
      vector_candidates: 80,
      lexical_candidates: 60,
      lexical_weight: 1.5,
      vector_weight: 2,
      hybrid_rrf_k: 40,
    });
  });

  it("keeps hybrid candidate and rerank controls separate", () => {
    const payload = buildSearchPayload({
      collection: "docs",
      mode: "hybrid",
      text: "schema design",
      vector_field: "embedding",
      lexical_fields: ["title", "body"],
      limit: 10,
      vector_candidates: 500,
      rerank_docs: 80,
      rerank_weight: 2.5,
    });
    expect(payload.vector_candidates).toBe(500);
    expect(payload.rerank_docs).toBe(80);
    expect(payload.rerank_weight).toBe(2.5);
    expect(payload.lexical_fields).toEqual(["title", "body"]);
    expect(payload.lexical_boosts).toEqual({ title: 1, body: 1 });
  });

  it("keeps per-field BM25 boosts for hybrid search", () => {
    const payload = buildSearchPayload({
      collection: "docs",
      mode: "hybrid",
      text: "schema design",
      vector_field: "embedding",
      lexical_fields: ["title", "body"],
      lexical_boosts: { title: 3, body: 0.5, ignored: 8 },
    });

    expect(payload.lexical_boosts).toEqual({ title: 3, body: 0.5 });
  });

  it("keeps and bounds a minimum vector similarity", () => {
    const payload = buildSearchPayload({
      collection: "docs",
      mode: "semantic",
      text: "schema design",
      vector_field: "embedding",
      min_score: 2,
    });

    expect(payload.min_score).toBe(1);
  });

  it("bounds the per-query timeout", () => {
    expect(buildSearchPayload({
      collection: "docs",
      mode: "semantic",
      text: "schema design",
      vector_field: "embedding",
      timeout_ms: 500,
    }).timeout_ms).toBe(1_000);
    expect(buildSearchPayload({
      collection: "docs",
      mode: "semantic",
      text: "schema design",
      vector_field: "embedding",
      timeout_ms: 999_999,
    }).timeout_ms).toBe(120_000);
  });

  it("combines structured and raw filters without duplicates", () => {
    const payload = buildSearchPayload({
      collection: "docs",
      mode: "semantic",
      text: "schema design",
      vector_field: "embedding",
      structured_filters: ['category:"schema"', "priority:[3 TO *]"],
      filters: 'category:"schema"\nstatus:published',
    });

    expect(payload.filters).toEqual([
      'category:"schema"',
      "priority:[3 TO *]",
      "status:published",
    ]);
  });
});

describe("saveSearchHistory", () => {
  it("caps locally stored searches at twenty", () => {
    const base = buildSearchPayload({
      collection: "docs",
      mode: "semantic",
      text: "query",
      vector_field: "embedding",
    });
    for (let index = 0; index < 25; index += 1) {
      saveSearchHistory({ ...base, text: `query ${index}` });
    }
    const saved = JSON.parse(window.localStorage.getItem(historyKey) ?? "[]");
    expect(saved).toHaveLength(20);
    expect(saved[0].payload.text).toBe("query 24");
  });

  it("moves an identical search to the front instead of duplicating it", () => {
    const first = buildSearchPayload({
      collection: "docs",
      mode: "semantic",
      text: "schema migration",
      vector_field: "embedding",
    });
    const second = { ...first, text: "vector search" };

    saveSearchHistory(first);
    saveSearchHistory(second);
    const saved = saveSearchHistory(first);

    expect(saved).toHaveLength(2);
    expect(saved.map((entry) => entry.payload.text)).toEqual(["schema migration", "vector search"]);
  });

  it("keeps single-field and comparison searches as separate history entries", () => {
    const payload = buildSearchPayload({
      collection: "docs",
      mode: "semantic",
      text: "schema migration",
      vector_field: "embedding",
    });

    saveSearchHistory(payload);
    const saved = saveSearchHistory(payload, ["embedding", "embedding_title"]);

    expect(saved).toHaveLength(2);
    expect(saved[0].comparison_fields).toEqual(["embedding", "embedding_title"]);
    expect(saved[1].comparison_fields).toBeUndefined();
  });

  it("persists per-field minimum scores for comparison searches", () => {
    const payload = buildSearchPayload({
      collection: "docs",
      mode: "semantic",
      text: "schema migration",
      vector_field: "embedding",
    });

    const saved = saveSearchHistory(
      payload,
      ["embedding", "embedding_title"],
      {
        targetMode: "compare",
        vectorMinScores: { embedding: 0.7, embedding_title: 0.8 },
      },
    );

    expect(saved[0].vector_min_scores).toEqual({
      embedding: 0.7,
      embedding_title: 0.8,
    });
  });

  it("loads legacy payload-only entries", () => {
    const legacy = buildSearchPayload({
      collection: "legacy_docs",
      mode: "semantic",
      text: "old query",
      vector_field: "embedding",
    });
    window.localStorage.setItem(historyKey, JSON.stringify([legacy, { broken: true }]));

    const loaded = loadSearchHistory();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("legacy-0");
    expect(loaded[0].payload).toEqual(legacy);
  });

  it("removes individual searches and clears all history", () => {
    const payload = buildSearchPayload({
      collection: "docs",
      mode: "semantic",
      text: "remove me",
      vector_field: "embedding",
    });
    const [entry] = saveSearchHistory(payload);

    expect(removeSearchHistory(entry.id)).toEqual([]);
    saveSearchHistory(payload);
    expect(clearSearchHistory()).toEqual([]);
    expect(window.localStorage.getItem(historyKey)).toBeNull();
  });
});

describe("searchPayloadToFormValues", () => {
  it("restores filter queries as editable lines", () => {
    const payload = buildSearchPayload({
      collection: "docs",
      mode: "hybrid",
      text: "schema design",
      vector_field: "embedding_title",
      lexical_fields: ["title", "body"],
      filters: "type:guide\nstatus:published",
      return_fields: ["id", "title"],
    });

    expect(searchPayloadToFormValues(payload)).toEqual({
      ...payload,
      filters: "type:guide\nstatus:published",
    });
  });
});
