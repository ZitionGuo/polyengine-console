import { summarizeSolrValue } from "./solrValue";

describe("summarizeSolrValue", () => {
  it("unwraps a single-valued Solr array", () => {
    expect(summarizeSolrValue(["Design review notes"])).toEqual({
      text: "Design review notes",
      tooltip: "Design review notes",
    });
  });

  it("joins short multi-valued fields without JSON syntax", () => {
    expect(summarizeSolrValue(["search", "solr", "vectors"]).text).toBe(
      "search · solr · vectors",
    );
  });

  it("summarizes dense vectors instead of rendering every number", () => {
    expect(summarizeSolrValue(Array.from({ length: 384 }, (_, index) => index / 10)).text).toBe(
      "384 numeric values",
    );
  });

  it("summarizes structured values", () => {
    expect(summarizeSolrValue({ owner: "search", priority: 2 }).text).toBe(
      "2 structured fields",
    );
    expect(summarizeSolrValue([{ id: 1 }, { id: 2 }]).text).toBe(
      "2 structured items",
    );
  });

  it("uses readable empty values", () => {
    expect(summarizeSolrValue(null).text).toBe("—");
    expect(summarizeSolrValue([]).text).toBe("No values");
  });
});
