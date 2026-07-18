import { describe, expect, it } from "vitest";

import {
  describeCollectionOverviewError,
  filterCollectionOverview,
  formatCollectionMetric,
  getCollectionHealth,
} from "./collectionOverview";

describe("collection overview helpers", () => {
  it("maps Qdrant and optimizer states to user-facing health", () => {
    expect(getCollectionHealth({ name: "ready", status: "green" })).toMatchObject({
      health: "healthy",
      label: "Healthy",
    });
    expect(getCollectionHealth({ name: "working", status: "yellow" }).health).toBe(
      "optimizing",
    );
    expect(getCollectionHealth({ name: "pending", status: "grey" }).label).toBe("Pending");
    expect(
      getCollectionHealth({
        name: "failed",
        status: "green",
        optimizer_status: { error: "disk full" },
      }).health,
    ).toBe("degraded");
    expect(
      getCollectionHealth({
        name: "offline",
        status: "unavailable",
        error: { name: "offline", status_code: 503 },
      }).health,
    ).toBe("unavailable");
  });

  it("filters by case-insensitive name and normalized health", () => {
    const collections = [
      { name: "Docs_Live", status: "green" },
      { name: "docs_archive", status: "yellow" },
      { name: "images", status: "red" },
    ];

    expect(filterCollectionOverview(collections, "DOCS", "all").map(({ name }) => name)).toEqual([
      "Docs_Live",
      "docs_archive",
    ]);
    expect(
      filterCollectionOverview(collections, "", "degraded").map(({ name }) => name),
    ).toEqual(["images"]);
  });

  it("formats missing metrics and extracts partial-load errors", () => {
    expect(formatCollectionMetric(12345)).toBe("12,345");
    expect(formatCollectionMetric(undefined)).toBe("-");
    expect(
      describeCollectionOverviewError({
        name: "docs",
        error: {
          name: "docs",
          detail: { message: "Unable to load details." },
        },
      }),
    ).toBe("Unable to load details.");
  });
});
