import { describe, expect, it } from "vitest";

import { buildSnapshotRestoreOptions } from "./snapshotRestore";

describe("snapshot restore options", () => {
  it("normalizes a valid checksum and preserves the selected priority", () => {
    expect(
      buildSnapshotRestoreOptions("docs", {
        priority: "snapshot",
        checksum: ` ${"A".repeat(64)} `,
        confirmation: "docs",
      }),
    ).toEqual({ priority: "snapshot", checksum: "a".repeat(64) });
  });

  it("requires the exact target collection name", () => {
    expect(() =>
      buildSnapshotRestoreOptions("docs_live", {
        priority: "replica",
        confirmation: "docs",
      }),
    ).toThrow("Type docs_live exactly");
  });

  it("rejects malformed SHA-256 checksums", () => {
    expect(() =>
      buildSnapshotRestoreOptions("docs", {
        priority: "no_sync",
        checksum: "abc123",
        confirmation: "docs",
      }),
    ).toThrow("64-character SHA-256");
  });
});
