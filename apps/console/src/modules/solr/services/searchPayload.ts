import type { SearchPayload } from "./api";

export interface SearchFormValues {
  collection: string;
  mode: "semantic" | "hybrid";
  hybrid_strategy?: "rerank" | "rrf";
  text: string;
  vector_field: string;
  lexical_fields?: string[];
  lexical_boosts?: Record<string, number>;
  limit?: number;
  vector_candidates?: number;
  lexical_candidates?: number;
  rerank_docs?: number;
  rerank_weight?: number;
  lexical_weight?: number;
  vector_weight?: number;
  hybrid_rrf_k?: number;
  timeout_ms?: number;
  min_score?: number | null;
  fusion_candidates?: number;
  rrf_k?: number;
  filters?: string;
  structured_filters?: string[];
  return_fields?: string[];
}

export interface SearchHistoryEntry {
  id: string;
  created_at: string;
  payload: SearchPayload;
  comparison_fields?: string[];
  target_mode?: "compare" | "fuse";
  vector_weights?: Record<string, number>;
  vector_min_scores?: Record<string, number>;
  fusion_candidates?: number;
  rrf_k?: number;
}

const HISTORY_KEY = "solr-vector-search-history";

export const buildSearchPayload = (values: SearchFormValues): SearchPayload => ({
  collection: values.collection,
  mode: values.mode,
  hybrid_strategy: values.hybrid_strategy ?? "rerank",
  text: values.text.trim(),
  vector_field: values.vector_field,
  lexical_fields: values.mode === "hybrid" ? values.lexical_fields ?? [] : [],
  lexical_boosts: values.mode === "hybrid"
    ? Object.fromEntries(
      (values.lexical_fields ?? []).map((field) => [
        field,
        Math.max(0, Math.min(20, values.lexical_boosts?.[field] ?? 1)),
      ]),
    )
    : {},
  limit: values.limit ?? 10,
  vector_candidates: values.vector_candidates ?? 100,
  lexical_candidates: values.lexical_candidates ?? 100,
  rerank_docs: values.rerank_docs ?? 100,
  rerank_weight: values.rerank_weight ?? 2,
  lexical_weight: Math.max(0, Math.min(10, values.lexical_weight ?? 1)),
  vector_weight: Math.max(0, Math.min(10, values.vector_weight ?? 1)),
  hybrid_rrf_k: values.hybrid_rrf_k ?? 60,
  timeout_ms: Math.max(1_000, Math.min(120_000, values.timeout_ms ?? 15_000)),
  min_score: values.min_score === null || values.min_score === undefined
    ? null
    : Math.max(-1, Math.min(1, values.min_score)),
  filters: [
    ...(values.structured_filters ?? []),
    ...(values.filters ?? "").split("\n"),
  ]
    .map((value) => value.trim())
    .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index),
  return_fields: values.return_fields ?? [],
});

const isHistoryEntry = (value: unknown): value is SearchHistoryEntry =>
  Boolean(
    value
      && typeof value === "object"
      && "id" in value
      && "created_at" in value
      && "payload" in value,
  );

const isLegacyPayload = (value: unknown): value is SearchPayload =>
  Boolean(value && typeof value === "object" && "collection" in value && "text" in value && "vector_field" in value);

const writeSearchHistory = (history: SearchHistoryEntry[]) => {
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 20)));
  return history.slice(0, 20);
};

export const loadSearchHistory = (): SearchHistoryEntry[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const migratedAt = new Date().toISOString();
    return parsed.flatMap((item, index) => {
      if (isHistoryEntry(item)) return [item];
      if (isLegacyPayload(item)) {
        return [{ id: `legacy-${index}`, created_at: migratedAt, payload: item }];
      }
      return [];
    });
  } catch {
    return [];
  }
};

export interface SearchHistoryOptions {
  targetMode?: "compare" | "fuse";
  vectorWeights?: Record<string, number>;
  vectorMinScores?: Record<string, number>;
  fusionCandidates?: number;
  rrfK?: number;
}

export const saveSearchHistory = (
  payload: SearchPayload,
  comparisonFields?: string[],
  options: SearchHistoryOptions = {},
): SearchHistoryEntry[] => {
  const cleanedComparison = comparisonFields && comparisonFields.length > 1
    ? [...new Set(comparisonFields)]
    : undefined;
  const targetMode = cleanedComparison ? options.targetMode ?? "compare" : undefined;
  const signature = JSON.stringify({
    payload,
    comparison_fields: cleanedComparison,
    target_mode: targetMode,
    vector_weights: targetMode === "fuse" ? options.vectorWeights : undefined,
    vector_min_scores: cleanedComparison ? options.vectorMinScores : undefined,
    fusion_candidates: targetMode === "fuse" ? options.fusionCandidates : undefined,
    rrf_k: targetMode === "fuse" ? options.rrfK : undefined,
  });
  const history = loadSearchHistory().filter(
    (item) => JSON.stringify({
      payload: item.payload,
      comparison_fields: item.comparison_fields,
      target_mode: item.target_mode,
      vector_weights: item.vector_weights,
      vector_min_scores: item.vector_min_scores,
      fusion_candidates: item.fusion_candidates,
      rrf_k: item.rrf_k,
    }) !== signature,
  );
  const entry: SearchHistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
    payload,
    comparison_fields: cleanedComparison,
    target_mode: targetMode,
    vector_weights: targetMode === "fuse" ? options.vectorWeights : undefined,
    vector_min_scores: cleanedComparison ? options.vectorMinScores : undefined,
    fusion_candidates: targetMode === "fuse" ? options.fusionCandidates : undefined,
    rrf_k: targetMode === "fuse" ? options.rrfK : undefined,
  };
  return writeSearchHistory([entry, ...history]);
};

export const removeSearchHistory = (id: string): SearchHistoryEntry[] =>
  writeSearchHistory(loadSearchHistory().filter((item) => item.id !== id));

export const clearSearchHistory = (): SearchHistoryEntry[] => {
  window.localStorage.removeItem(HISTORY_KEY);
  return [];
};

export const searchPayloadToFormValues = (payload: SearchPayload): SearchFormValues => ({
  ...payload,
  min_score: payload.min_score ?? null,
  filters: payload.filters.join("\n"),
});
