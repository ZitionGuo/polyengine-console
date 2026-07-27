import { clearSelectedThresholds, hasSelectedThreshold } from "./thresholds";

describe("threshold recovery", () => {
  it("clears only thresholds for the active vector fields", () => {
    expect(clearSelectedThresholds(
      ["embedding", "embedding_title"],
      {
        embedding: 0.8,
        embedding_title: 0.9,
        embedding_archive: 0.7,
      },
    )).toEqual({
      embedding: null,
      embedding_title: null,
      embedding_archive: 0.7,
    });
  });

  it("detects selected thresholds and ignores unselected fields", () => {
    expect(hasSelectedThreshold(
      ["embedding", "embedding_title"],
      { embedding: null, embedding_title: 0.82, embedding_archive: 0.9 },
    )).toBe(true);
    expect(hasSelectedThreshold(
      ["embedding", "embedding_title"],
      { embedding: null, embedding_archive: 0.9 },
    )).toBe(false);
  });
});
