import { describe, expect, it } from "vitest";

import {
  getClusterMode,
  shouldRequestCollectionCluster,
  shouldRequestCollectionDetails,
} from "./cluster";

describe("cluster query strategy", () => {
  it("reads enabled and disabled modes from Qdrant envelopes", () => {
    expect(getClusterMode({ result: { status: "enabled" }, status: "ok" })).toBe("enabled");
    expect(getClusterMode({ result: { status: "disabled" }, status: "ok" })).toBe("disabled");
    expect(getClusterMode({ status: "ok" })).toBe("unknown");
  });

  it("uses the collection cluster endpoint only for enabled clusters", () => {
    expect(shouldRequestCollectionCluster(true, true, "enabled")).toBe(true);
    expect(shouldRequestCollectionCluster(true, true, "disabled")).toBe(false);
    expect(shouldRequestCollectionCluster(true, false, "enabled")).toBe(false);
  });

  it("loads collection details for single-node or failed cluster requests", () => {
    expect(shouldRequestCollectionDetails(true, true, "disabled", false)).toBe(true);
    expect(shouldRequestCollectionDetails(true, true, "enabled", true)).toBe(true);
    expect(shouldRequestCollectionDetails(true, true, "enabled", false)).toBe(false);
    expect(shouldRequestCollectionDetails(true, false, "unknown", false)).toBe(false);
  });
});
