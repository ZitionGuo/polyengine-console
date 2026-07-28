import { describe, expect, it } from "vitest";

import { buildSearchPayload, parseFilterDsl } from "./searchPayload";

describe("Elasticsearch search payload", () => {
  it("preserves multiple vector targets with independent providers and weights", () => {
    const payload = buildSearchPayload({
      index: "articles",
      text: "vector search",
      result_mode: "fuse",
      vector_targets: [
        { field: "title_embedding", provider: "local", weight: 2 },
        {
          field: "body_embedding",
          provider: "inference",
          inference_id: "qwen-endpoint",
          weight: 0.7,
          min_similarity: 0.2,
        },
      ],
      top_k: 20,
      rank_window_size: 10,
    });

    expect(payload.result_mode).toBe("fuse");
    expect(payload.vector_targets).toEqual([
      { field: "title_embedding", provider: "local", weight: 2 },
      {
        field: "body_embedding",
        provider: "inference",
        inference_id: "qwen-endpoint",
        weight: 0.7,
        min_similarity: 0.2,
      },
    ]);
    expect(payload.rank_window_size).toBe(20);
  });

  it("forces single mode when only one vector field is selected", () => {
    const payload = buildSearchPayload({
      index: "articles",
      text: "hello",
      result_mode: "compare",
      vector_targets: [{ field: "embedding" }],
    });
    expect(payload.result_mode).toBe("single");
  });

  it("accepts only arrays of Elasticsearch filter objects", () => {
    expect(parseFilterDsl('[{"term":{"category":"docs"}}]')).toHaveLength(1);
    expect(() => parseFilterDsl('{"term":{"category":"docs"}}')).toThrow(
      "JSON array",
    );
  });
});
