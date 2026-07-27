import { scoreSemantics, supportsSimilarityAnalysis } from "./scoreSemantics";

describe("score semantics", () => {
  it("distinguishes vector similarity, hybrid score, and rank fusion score", () => {
    expect(scoreSemantics("single", "semantic").label).toBe("Similarity");
    expect(scoreSemantics("single", "hybrid").label).toBe("Hybrid score");
    expect(scoreSemantics("single", "hybrid", "rrf").label).toBe("RRF score");
    expect(scoreSemantics("compare", "hybrid").label).toBe("Hybrid score");
    expect(scoreSemantics("compare", "hybrid", "rrf").label).toBe("RRF score");
    expect(scoreSemantics("fuse", "semantic").label).toBe("RRF score");
    expect(scoreSemantics("fuse", "hybrid").label).toBe("RRF score");
  });

  it("only derives similarity thresholds from semantic results", () => {
    expect(supportsSimilarityAnalysis("semantic")).toBe(true);
    expect(supportsSimilarityAnalysis("hybrid")).toBe(false);
    expect(supportsSimilarityAnalysis(undefined)).toBe(false);
  });
});
