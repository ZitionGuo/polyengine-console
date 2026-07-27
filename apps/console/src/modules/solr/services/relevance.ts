import type { SearchPayload } from "./api";

export type RelevanceJudgment = "relevant" | "irrelevant";
export type RelevanceJudgments = Record<string, RelevanceJudgment>;

interface StoredJudgmentContext {
  context: string;
  updated_at: string;
  judgments: RelevanceJudgments;
}

const STORAGE_KEY = "solr-vector-relevance-judgments";

const loadStore = (): StoredJudgmentContext[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StoredJudgmentContext =>
        Boolean(
          item
          && typeof item === "object"
          && "context" in item
          && "updated_at" in item
          && "judgments" in item,
        ),
    );
  } catch {
    return [];
  }
};

const writeStore = (store: StoredJudgmentContext[]) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store.slice(0, 50)));
};

export const relevanceContext = (payload: SearchPayload): string =>
  JSON.stringify({
    collection: payload.collection,
    mode: payload.mode,
    text: payload.text.trim().toLowerCase(),
    lexical_fields: [...payload.lexical_fields].sort(),
    lexical_boosts: Object.fromEntries(Object.entries(payload.lexical_boosts).sort(([left], [right]) => left.localeCompare(right))),
    filters: [...payload.filters].sort(),
  });

export const documentJudgmentKey = (document: Record<string, unknown>): string => {
  if (document.id !== undefined && document.id !== null) return `id:${String(document.id)}`;
  const normalized = Object.fromEntries(
    Object.entries(document)
      .filter(([key]) => key !== "score" && key !== "_version_")
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return `document:${JSON.stringify(normalized)}`;
};

export const loadRelevanceJudgments = (context: string): RelevanceJudgments =>
  loadStore().find((item) => item.context === context)?.judgments ?? {};

export const updateRelevanceJudgment = (
  context: string,
  documentKey: string,
  judgment?: RelevanceJudgment,
): RelevanceJudgments => {
  const store = loadStore();
  const current = store.find((item) => item.context === context)?.judgments ?? {};
  const next = { ...current };
  if (judgment) next[documentKey] = judgment;
  else delete next[documentKey];
  const entry: StoredJudgmentContext = {
    context,
    updated_at: new Date().toISOString(),
    judgments: next,
  };
  writeStore([entry, ...store.filter((item) => item.context !== context)]);
  return next;
};

export const clearRelevanceJudgments = (context: string): RelevanceJudgments => {
  writeStore(loadStore().filter((item) => item.context !== context));
  return {};
};

export interface RelevanceStats {
  total: number;
  judged: number;
  relevant: number;
  irrelevant: number;
}

export const relevanceStats = (
  documents: Array<Record<string, unknown>>,
  judgments: RelevanceJudgments,
): RelevanceStats => {
  const keys = [...new Set(documents.map(documentJudgmentKey))];
  return keys.reduce<RelevanceStats>(
    (stats, key) => {
      const judgment = judgments[key];
      if (judgment) stats.judged += 1;
      if (judgment === "relevant") stats.relevant += 1;
      if (judgment === "irrelevant") stats.irrelevant += 1;
      return stats;
    },
    { total: keys.length, judged: 0, relevant: 0, irrelevant: 0 },
  );
};

export interface RankingMetrics {
  cutoff: number;
  judged: number;
  relevant: number;
  coverage: number;
  judged_precision: number;
  reciprocal_rank: number;
  ndcg: number;
}

const roundedMetric = (value: number) => Math.round(value * 10_000) / 10_000;

export const rankingMetrics = (
  documents: Array<Record<string, unknown>>,
  judgments: RelevanceJudgments,
): RankingMetrics => {
  const rankedJudgments = documents.map((document) => judgments[documentJudgmentKey(document)]);
  const judged = rankedJudgments.filter(Boolean).length;
  const relevantRanks = rankedJudgments.flatMap((judgment, index) =>
    judgment === "relevant" ? [index + 1] : []);
  const relevant = relevantRanks.length;
  const discountedGain = relevantRanks.reduce(
    (total, rank) => total + 1 / Math.log2(rank + 1),
    0,
  );
  const idealGain = Array.from(
    { length: relevant },
    (_, index) => 1 / Math.log2(index + 2),
  ).reduce((total, gain) => total + gain, 0);

  return {
    cutoff: documents.length,
    judged,
    relevant,
    coverage: documents.length ? roundedMetric(judged / documents.length) : 0,
    judged_precision: judged ? roundedMetric(relevant / judged) : 0,
    reciprocal_rank: relevantRanks.length ? roundedMetric(1 / relevantRanks[0]) : 0,
    ndcg: idealGain ? roundedMetric(discountedGain / idealGain) : 0,
  };
};
