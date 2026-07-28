import type {
  FusionBackend,
  LexicalField,
  ResultMode,
  SearchMode,
  SearchPayload,
  VectorProvider,
  VectorTarget,
} from "./api";

export interface VectorTargetFormValue {
  field?: string;
  provider?: VectorProvider;
  inference_id?: string;
  weight?: number | null;
  min_similarity?: number | null;
  num_candidates?: number | null;
}

export interface SearchFormValues {
  index?: string;
  text?: string;
  mode?: SearchMode;
  result_mode?: ResultMode;
  fusion_backend?: FusionBackend;
  vector_targets?: VectorTargetFormValue[];
  lexical_fields?: string[];
  lexical_boosts?: Record<string, number>;
  lexical_weight?: number | null;
  top_k?: number | null;
  num_candidates?: number | null;
  rank_constant?: number | null;
  rank_window_size?: number | null;
  filters_json?: string;
  source_fields?: string[];
  timeout_ms?: number | null;
}

export const parseFilterDsl = (value?: string): Array<Record<string, unknown>> => {
  const trimmed = value?.trim();
  if (!trimmed) return [];
  const parsed: unknown = JSON.parse(trimmed);
  if (!Array.isArray(parsed) || parsed.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error("Filter DSL must be a JSON array of Elasticsearch query objects.");
  }
  return parsed as Array<Record<string, unknown>>;
};

export const buildSearchPayload = (values: SearchFormValues): SearchPayload => {
  const vectorTargets: VectorTarget[] = (values.vector_targets ?? [])
    .filter((target): target is VectorTargetFormValue & { field: string } => Boolean(target.field))
    .map((target) => ({
      field: target.field,
      provider: target.provider ?? "local",
      ...(target.inference_id?.trim() ? { inference_id: target.inference_id.trim() } : {}),
      weight: target.weight ?? 1,
      ...(target.min_similarity === null || target.min_similarity === undefined
        ? {}
        : { min_similarity: target.min_similarity }),
      ...(target.num_candidates === null || target.num_candidates === undefined
        ? {}
        : { num_candidates: target.num_candidates }),
    }));
  const lexicalFields: LexicalField[] = (values.lexical_fields ?? []).map((field) => ({
    field,
    boost: values.lexical_boosts?.[field] ?? 1,
  }));

  return {
    index: values.index?.trim() ?? "",
    text: values.text?.trim() ?? "",
    mode: values.mode ?? "vector",
    result_mode: vectorTargets.length === 1 ? "single" : (values.result_mode ?? "fuse"),
    fusion_backend: values.fusion_backend ?? "application",
    vector_targets: vectorTargets,
    lexical_fields: lexicalFields,
    lexical_weight: values.lexical_weight ?? 1,
    top_k: values.top_k ?? 10,
    num_candidates: values.num_candidates ?? 100,
    rank_constant: values.rank_constant ?? 60,
    rank_window_size: Math.max(values.rank_window_size ?? 100, values.top_k ?? 10),
    filters: parseFilterDsl(values.filters_json),
    source_fields: values.source_fields ?? [],
    timeout_ms: values.timeout_ms ?? 15_000,
  };
};
