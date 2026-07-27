import { afterEach, vi } from "vitest";

import { api, errorMessage, type SearchPayload } from "./api";

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
