import { afterEach, vi } from "vitest";

import {
  api,
  errorMessage,
  type IngestJobPayload,
  type SearchPayload,
} from "./api";

const payload: SearchPayload = {
  collection: "docs",
  mode: "semantic",
  hybrid_strategy: "rerank",
  text: "schema migrations",
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
  filters: [],
  return_fields: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("errorMessage", () => {
  it("extracts normalized backend errors", () => {
    expect(errorMessage({ detail: { message: "Dimension mismatch" } })).toBe("Dimension mismatch");
  });

  it("handles ordinary errors", () => {
    expect(errorMessage(new Error("Failed to fetch"))).toBe("Failed to fetch");
  });
});

describe("search cancellation", () => {
  it("passes the abort signal to fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ response: { response: { docs: [] } } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await api.search(payload, controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/solr/search",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("preserves AbortError instead of reporting a network failure", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    await expect(api.search(payload, new AbortController().signal)).rejects.toBe(abortError);
  });
});

describe("embedding preview", () => {
  it("sends query text and the abort signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "model",
          dimension: 2,
          vector: [0.1, 0.2],
          statistics: { l2_norm: 0.2236, minimum: 0.1, maximum: 0.2, mean: 0.15 },
          timings: { model_load_ms: 0, embedding_ms: 1, total_ms: 1 },
          cold_start: false,
          cache_hit: false,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await api.previewEmbedding("schema migration", controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/solr/model/embed",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "schema migration" }),
        signal: controller.signal,
      }),
    );
  });
});

describe("ingest jobs", () => {
  it("sends independent source mappings for every vector target", async () => {
    const ingestPayload: IngestJobPayload = {
      upload_id: "upload-1",
      collection: "docs",
      id_field: "id",
      vector_targets: [
        { vector_field: "embedding", text_fields: ["title", "content"] },
        { vector_field: "embedding_title", text_fields: ["title"] },
      ],
      batch_size: 64,
      commit_within_ms: 1000,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "job-1",
          collection: "docs",
          filename: "documents.jsonl",
          vector_targets: ingestPayload.vector_targets,
          status: "queued",
          total: 2,
          processed: 0,
          succeeded: 0,
          failed: 0,
          created_at: "2026-07-28T00:00:00Z",
        }),
        { status: 202 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.createJob(ingestPayload);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/solr/ingest/jobs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(ingestPayload),
      }),
    );
  });

  it("starts a failed-row retry using the encoded job id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "retry-1",
          collection: "docs",
          filename: "documents.jsonl",
          vector_targets: [{ vector_field: "embedding", text_fields: ["title"] }],
          retry_of: "job 1",
          retryable_rows: 0,
          status: "queued",
          total: 1,
          processed: 0,
          succeeded: 0,
          failed: 0,
          created_at: "2026-07-28T00:00:00Z",
        }),
        { status: 202 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.retryJob("job 1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/solr/ingest/jobs/job%201/retry",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("loads a paginated ingest error page", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [{ row: 26, document_id: "doc-26", message: "Temporary failure." }],
          total: 30,
          offset: 25,
          limit: 25,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await api.jobErrors("job 1", 25, 25, controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/solr/ingest/jobs/job%201/error-rows?offset=25&limit=25",
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
