import { buildScoreProfiles } from "./scoreProfile";

describe("buildScoreProfiles", () => {
  it("calculates quartiles and the largest score gap", () => {
    const [profile] = buildScoreProfiles([{
      vector_field: "embedding",
      documents: [
        { score: 0.95 },
        { score: 0.9 },
        { score: 0.7 },
        { score: 0.65 },
        { score: 0.6 },
      ],
    }]);

    expect(profile).toMatchObject({
      vector_field: "embedding",
      count: 5,
      minimum: 0.6,
      lower_quartile: 0.65,
      median: 0.7,
      upper_quartile: 0.9,
      maximum: 0.95,
    });
    expect(profile.largest_gap_cutoff).toBeCloseTo(0.8);
  });

  it("ignores missing and non-numeric scores", () => {
    expect(buildScoreProfiles([
      {
        vector_field: "embedding",
        documents: [{ score: 0.8 }, { score: "0.7" }, { id: "missing" }],
      },
      {
        vector_field: "empty",
        documents: [{ score: Number.NaN }],
      },
    ])).toHaveLength(1);
  });

  it("builds the same profile from compact source score samples", () => {
    const [profile] = buildScoreProfiles([{
      vector_field: "embedding_title",
      score_samples: [0.82, 0.91, 0.73],
    }]);

    expect(profile).toMatchObject({
      vector_field: "embedding_title",
      count: 3,
      minimum: 0.73,
      median: 0.82,
      maximum: 0.91,
      scores: [0.91, 0.82, 0.73],
    });
  });
});
