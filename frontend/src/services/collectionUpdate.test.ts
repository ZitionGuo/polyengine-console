import { describe, expect, it } from "vitest";

import { buildCollectionUpdatePayload } from "./collectionUpdate";

describe("buildCollectionUpdatePayload", () => {
  it("maps common fields to Qdrant update groups", () => {
    expect(
      buildCollectionUpdatePayload({
        replicationFactor: 2,
        writeConsistencyFactor: 1,
        onDiskPayload: false,
        indexingThreshold: 25000,
        hnswEfConstruct: 128,
      }),
    ).toEqual({
      params: {
        replication_factor: 2,
        write_consistency_factor: 1,
        on_disk_payload: false,
      },
      optimizers_config: { indexing_threshold: 25000 },
      hnsw_config: { ef_construct: 128 },
    });
  });

  it("deep merges advanced settings", () => {
    expect(
      buildCollectionUpdatePayload({
        indexingThreshold: 10000,
        advancedJson: '{"optimizers_config":{"max_segment_size":50000},"metadata":{"owner":"local"}}',
      }),
    ).toEqual({
      optimizers_config: {
        indexing_threshold: 10000,
        max_segment_size: 50000,
      },
      metadata: { owner: "local" },
    });
  });

  it("rejects an empty update", () => {
    expect(() => buildCollectionUpdatePayload({})).toThrow(
      "Choose at least one setting to update.",
    );
  });
});
