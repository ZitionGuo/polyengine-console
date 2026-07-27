export interface ScoreProfileInput {
  vector_field: string;
  documents?: Array<Record<string, unknown>>;
  score_samples?: number[];
}

export interface ScoreProfile {
  vector_field: string;
  count: number;
  minimum: number;
  lower_quartile: number;
  median: number;
  upper_quartile: number;
  maximum: number;
  largest_gap_cutoff: number | null;
  scores: number[];
}

const quantile = (sorted: number[], percentile: number) => {
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
};

const largestGapCutoff = (scoresDescending: number[]) => {
  if (scoresDescending.length < 2) return null;
  let largestGap = 0;
  let cutoff: number | null = null;
  for (let index = 0; index < scoresDescending.length - 1; index += 1) {
    const current = scoresDescending[index];
    const next = scoresDescending[index + 1];
    const gap = current - next;
    if (gap > largestGap) {
      largestGap = gap;
      cutoff = (current + next) / 2;
    }
  }
  return cutoff;
};

export const buildScoreProfiles = (inputs: ScoreProfileInput[]): ScoreProfile[] =>
  inputs.flatMap(({ vector_field, documents = [], score_samples }) => {
    const scoresDescending = (score_samples ?? documents.map((document) => document.score))
      .filter((score): score is number => typeof score === "number" && Number.isFinite(score))
      .sort((left, right) => right - left);
    if (!scoresDescending.length) return [];
    const ascending = [...scoresDescending].reverse();
    return [{
      vector_field,
      count: ascending.length,
      minimum: ascending[0],
      lower_quartile: quantile(ascending, 0.25),
      median: quantile(ascending, 0.5),
      upper_quartile: quantile(ascending, 0.75),
      maximum: ascending[ascending.length - 1],
      largest_gap_cutoff: largestGapCutoff(scoresDescending),
      scores: scoresDescending,
    }];
  });
