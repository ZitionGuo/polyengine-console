import type {
  CompareSearchPayload,
  CompareSearchResult,
  FuseSearchResult,
  FuseSearchPayload,
  SearchPayload,
} from "./api";

export const MAX_MULTI_VECTOR_FIELDS = 16;

const selectedMinScores = (
  fields: string[],
  vectorMinScores: Record<string, number | null>,
) => Object.fromEntries(
  fields.flatMap((field) => {
    const score = vectorMinScores[field];
    return score === null || score === undefined
      ? []
      : [[field, Math.max(-1, Math.min(1, score))]];
  }),
);

export const buildCompareSearchPayload = (
  payload: SearchPayload,
  vectorFields: string[],
  vectorMinScores: Record<string, number | null> = {},
): CompareSearchPayload => {
  const { vector_field: _vectorField, ...shared } = payload;
  const fields = [...new Set(vectorFields)].slice(0, MAX_MULTI_VECTOR_FIELDS);
  return {
    ...shared,
    min_score: null,
    vector_fields: fields,
    vector_min_scores: selectedMinScores(fields, vectorMinScores),
  };
};

export const buildFuseSearchPayload = (
  payload: SearchPayload,
  vectorFields: string[],
  vectorWeights: Record<string, number>,
  fusionCandidates: number,
  rrfK: number,
  vectorMinScores: Record<string, number | null> = {},
): FuseSearchPayload => {
  const { vector_field: _vectorField, ...shared } = payload;
  const fields = [...new Set(vectorFields)].slice(0, MAX_MULTI_VECTOR_FIELDS);
  return {
    ...shared,
    min_score: null,
    vector_fields: fields,
    vector_min_scores: selectedMinScores(fields, vectorMinScores),
    vector_weights: Object.fromEntries(
      fields.map((field) => [field, Math.max(0, Math.min(10, vectorWeights[field] ?? 1))]),
    ),
    fusion_candidates: Math.max(payload.limit, fusionCandidates),
    rrf_k: rrfK,
  };
};

const documentKey = (document: Record<string, unknown>, index: number) =>
  String(document.id ?? document._version_ ?? `rank-${index}`);

export interface ComparisonOverlap {
  shared: number;
  comparable: number;
  percentage: number;
}

export const fusionFieldDiagnostics = (result?: FuseSearchResult) => ({
  active: result?.field_results
    .filter((item) => item.status === "ok")
    .map((item) => item.vector_field) ?? [],
  failed: result?.field_results
    .filter((item) => item.status === "error")
    .map((item) => item.vector_field) ?? [],
  skipped: result?.field_results
    .filter((item) => item.status === "skipped")
    .map((item) => item.vector_field) ?? [],
});

export const sourceReturnedCount = (item: {
  returned?: number;
  response?: { response?: { docs?: Array<Record<string, unknown>> } };
}) => item.returned ?? item.response?.response?.docs?.length ?? 0;

export const comparisonOverlap = (result?: CompareSearchResult): ComparisonOverlap | null => {
  const documentSets = (result?.results ?? [])
    .filter((item) => item.status === "ok")
    .map((item) => item.response?.response?.docs ?? [])
    .filter((documents) => documents.length)
    .map((documents) => new Set(documents.map(documentKey)));
  if (documentSets.length < 2) return null;

  const [first, ...rest] = documentSets;
  const shared = [...first].filter((key) => rest.every((keys) => keys.has(key))).length;
  const comparable = Math.min(...documentSets.map((keys) => keys.size));
  return {
    shared,
    comparable,
    percentage: comparable ? Math.round((shared / comparable) * 100) : 0,
  };
};
