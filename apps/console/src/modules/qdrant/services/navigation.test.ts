import { describe, expect, it } from "vitest";

import {
  getCollectionNameFromPath,
  getCollectionPath,
  getPageDocumentTitle,
  getPageFromPath,
  getPagePath,
} from "./navigation";

describe("dashboard navigation", () => {
  it("maps canonical and trailing-slash paths to dashboard pages", () => {
    expect(getPageFromPath("/qdrant/collections/")).toBe("collections");
    expect(getPageFromPath("/qdrant/aliases")).toBe("aliases");
    expect(getPageFromPath("/qdrant/cluster/")).toBe("cluster");
    expect(getPageFromPath("/qdrant/rest")).toBe("rest");
    expect(getPageFromPath("/qdrant/collections/my%20collection")).toBe("collections");
  });

  it("rejects unknown paths and returns canonical paths", () => {
    expect(getPageFromPath("/missing")).toBeNull();
    expect(getPageFromPath("/qdrant/collections/name/extra")).toBeNull();
    expect(getPagePath("collections")).toBe("/qdrant/collections");
    expect(getPagePath("rest")).toBe("/qdrant/rest");
  });

  it("builds useful page-specific document titles", () => {
    expect(getPageDocumentTitle("cluster")).toBe(
      "Cluster · Qdrant · PolyEngine Console",
    );
    expect(getPageDocumentTitle("rest")).toBe(
      "REST Console · Qdrant · PolyEngine Console",
    );
  });

  it("round-trips encoded collection detail paths", () => {
    const collectionName = "中文 / production #1";
    const path = getCollectionPath(collectionName);

    expect(path).toBe(
      "/qdrant/collections/%E4%B8%AD%E6%96%87%20%2F%20production%20%231",
    );
    expect(getCollectionNameFromPath(path)).toBe(collectionName);
    expect(getCollectionNameFromPath(`${path}/`)).toBe(collectionName);
  });

  it("rejects malformed and nested collection detail paths", () => {
    expect(getCollectionNameFromPath("/qdrant/collections")).toBeNull();
    expect(getCollectionNameFromPath("/qdrant/collections/name/extra")).toBeNull();
    expect(getCollectionNameFromPath("/qdrant/collections/%E0%A4%A")).toBeNull();
    expect(getPageFromPath("/qdrant/collections/%E0%A4%A")).toBeNull();
  });
});
