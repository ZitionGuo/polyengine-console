import { describe, expect, it } from "vitest";

import {
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
  });

  it("rejects unknown paths and returns canonical paths", () => {
    expect(getPageFromPath("/missing")).toBeNull();
    expect(getPageFromPath("/collections/extra")).toBeNull();
    expect(getPagePath("collections")).toBe("/collections");
    expect(getPagePath("rest")).toBe("/rest");
  });

  it("builds useful page-specific document titles", () => {
    expect(getPageDocumentTitle("cluster")).toBe("Cluster · Qdrant Local Admin");
    expect(getPageDocumentTitle("rest")).toBe("REST Console · Qdrant Local Admin");
  });
});
