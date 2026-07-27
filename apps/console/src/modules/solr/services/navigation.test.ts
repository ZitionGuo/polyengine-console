import { pageFromPath, pagePath, selectCollection, selectedCollection } from "./navigation";

describe("navigation", () => {
  it("maps stable page paths", () => {
    expect(pageFromPath("/solr/collections")).toBe("collections");
    expect(pageFromPath("/solr/search")).toBe("search");
    expect(pageFromPath("/solr/ingest/jobs")).toBe("ingest");
    expect(pagePath("search")).toBe("/solr/search");
  });

  it("keeps the selected collection between workflows", () => {
    selectCollection("articles");
    expect(selectedCollection()).toBe("articles");
  });
});
