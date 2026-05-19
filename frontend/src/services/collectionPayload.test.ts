import { describe, expect, it } from "vitest";

import { buildCollectionCreatePayload } from "./collectionPayload";

describe("buildCollectionCreatePayload", () => {
  it("builds dense vectors, sparse vectors, indexes, and advanced config", () => {
    const result = buildCollectionCreatePayload({
      name: "docs",
      vectorMode: "single",
      singleVector: { size: 768, distance: "Cosine", onDisk: true },
      sparseVectors: [{ name: "text", modifier: "idf", onDisk: false }],
      replicationFactor: 2,
      writeConsistencyFactor: 1,
      onDiskPayload: true,
      advancedJson: '{"hnsw_config":{"m":16}}',
      indexes: [
        { fieldName: "source", type: "keyword", isTenant: true },
        { fieldName: "content", type: "text", tokenizer: "word", lowercase: true },
      ],
    });

    expect(result.name).toBe("docs");
    expect(result.body.config).toEqual({
      vectors: { size: 768, distance: "Cosine", on_disk: true },
      sparse_vectors: { text: { modifier: "idf", index: { on_disk: false } } },
      replication_factor: 2,
      write_consistency_factor: 1,
      on_disk_payload: true,
      hnsw_config: { m: 16 },
    });
    expect(result.body.indexes).toEqual([
      { field_name: "source", field_schema: { type: "keyword", is_tenant: true } },
      {
        field_name: "content",
        field_schema: {
          type: "text",
          tokenizer: "word",
          lowercase: true,
        },
      },
    ]);
  });

  it("builds named vectors", () => {
    const result = buildCollectionCreatePayload({
      name: "media",
      vectorMode: "named",
      namedVectors: [
        { name: "image", size: 512, distance: "Dot" },
        { name: "text", size: 384, distance: "Cosine" },
      ],
    });

    expect(result.body.config.vectors).toEqual({
      image: { size: 512, distance: "Dot" },
      text: { size: 384, distance: "Cosine" },
    });
  });
});
