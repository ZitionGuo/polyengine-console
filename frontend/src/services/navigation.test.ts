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
    expect(getPageFromPath("/")).toBe("collections");
    expect(getPageFromPath("/collections/")).toBe("collections");
    expect(getPageFromPath("/aliases")).toBe("aliases");
    expect(getPageFromPath("/cluster/")).toBe("cluster");
    expect(getPageFromPath("/rest")).toBe("rest");
    expect(getPageFromPath("/collections/my%20collection")).toBe("collections");
  });

  it("rejects unknown paths and returns canonical paths", () => {
    expect(getPageFromPath("/missing")).toBeNull();
    expect(getPageFromPath("/collections/name/extra")).toBeNull();
    expect(getPagePath("collections")).toBe("/collections");
    expect(getPagePath("rest")).toBe("/rest");
  });

  it("builds useful page-specific document titles", () => {
    expect(getPageDocumentTitle("cluster")).toBe("Cluster · Qdrant Local Admin");
    expect(getPageDocumentTitle("rest")).toBe("REST Console · Qdrant Local Admin");
  });

  it("round-trips encoded collection detail paths", () => {
    const collectionName = "中文 / production #1";
    const path = getCollectionPath(collectionName);

    expect(path).toBe("/collections/%E4%B8%AD%E6%96%87%20%2F%20production%20%231");
    expect(getCollectionNameFromPath(path)).toBe(collectionName);
    expect(getCollectionNameFromPath(`${path}/`)).toBe(collectionName);
  });

  it("rejects malformed and nested collection detail paths", () => {
    expect(getCollectionNameFromPath("/collections")).toBeNull();
    expect(getCollectionNameFromPath("/collections/name/extra")).toBeNull();
    expect(getCollectionNameFromPath("/collections/%E0%A4%A")).toBeNull();
    expect(getPageFromPath("/collections/%E0%A4%A")).toBeNull();
  });
});
