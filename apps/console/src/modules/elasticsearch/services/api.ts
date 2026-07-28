export type ModelState = "not_loaded" | "loading" | "ready" | "error";
export type SearchMode = "vector" | "hybrid";
export type ResultMode = "single" | "compare" | "fuse";
export type VectorProvider = "local" | "field_native" | "inference";
export type FusionBackend = "application" | "elasticsearch";

export interface ModelStatus {
  name: string;
  dimension: number;
  status: ModelState;
  error?: string | null;
  query_cache?: {
    entries: number;
    capacity: number;
    ttl_seconds: number;
  };
}

export interface ElasticsearchHealth {
  status: "ok" | "unsupported";
  elasticsearch: {
    version: string;
    cluster_name?: string;
    cluster_uuid?: string;
    health?: string;
    nodes?: number;
    endpoint: string;
  };
  capabilities: {
    type: string;
    status?: string;
    native_rrf: boolean;
    inference: boolean;
  };
  model: ModelStatus;
}

export interface MappingField {
  name: string;
  type: string;
  indexed?: boolean;
}

export interface VectorField extends MappingField {
  dimension?: number | null;
  similarity?: string;
  element_type?: string;
  index_options?: Record<string, unknown>;
  inference_id?: string | null;
  local_compatible: boolean;
  compatible: boolean;
  reason?: string | null;
}

export interface IndexSummary {
  name: string;
  health?: string;
  status?: string;
  document_count?: number | null;
  store_size?: string;
  aliases: string[];
  vector_fields: VectorField[];
  text_fields: MappingField[];
  ready: boolean;
  error?: unknown;
}

export interface IndicesResult {
  indices: IndexSummary[];
  model_dimension: number;
}

export interface IndexSchema {
  index: string;
  fields: MappingField[];
  vector_fields: VectorField[];
  text_fields: MappingField[];
}

export interface InferenceEndpoint {
  id: string;
  task_type: string;
  service?: string | null;
}

export interface InferenceResult {
  available: boolean;
  endpoints: InferenceEndpoint[];
  error?: unknown;
}

export interface VectorTarget {
  field: string;
  provider: VectorProvider;
  inference_id?: string;
  weight: number;
  min_similarity?: number | null;
  num_candidates?: number | null;
}

export interface LexicalField {
  field: string;
  boost: number;
}

export interface SearchPayload {
  index: string;
  text: string;
  mode: SearchMode;
  result_mode: ResultMode;
  fusion_backend: FusionBackend;
  vector_targets: VectorTarget[];
  lexical_fields: LexicalField[];
  lexical_weight: number;
  top_k: number;
  num_candidates: number;
  rank_constant: number;
  rank_window_size: number;
  filters: Array<Record<string, unknown>>;
  source_fields: string[];
  timeout_ms: number;
}

export interface ElasticsearchHit {
  _index?: string;
  _id?: string;
  _score?: number | null;
  _source?: Record<string, unknown>;
  highlight?: Record<string, string[]>;
  _fusion?: {
    method: string;
    ranks: Record<string, number>;
    source_scores: Record<string, number>;
    contributions: Record<string, number>;
  };
}

export interface SourceResult {
  source: string;
  status: "ok" | "error";
  request: Record<string, unknown>;
  request_ms?: number;
  took?: number;
  timed_out?: boolean;
  total?: unknown;
  hits: ElasticsearchHit[];
  error?: unknown;
}

export interface SearchResult {
  index: string;
  mode: SearchMode;
  result_mode: ResultMode;
  fusion_backend: FusionBackend;
  model?: string | null;
  dimension?: number | null;
  embedding_cache_hit?: boolean | null;
  hits: ElasticsearchHit[];
  result_sets: Array<{
    label: string;
    status: "ok" | "error";
    hits: ElasticsearchHit[];
    sources: string[];
    error?: unknown;
  }>;
  source_results: SourceResult[];
  generated_requests: Array<{ source: string; body: Record<string, unknown> }>;
  timings: {
    embedding_ms: number;
    elasticsearch_ms: number;
    fusion_ms: number;
    total_ms: number;
  };
}

export interface EmbeddingPreview {
  model: string;
  dimension: number;
  vector: number[];
  statistics: {
    l2_norm: number;
    minimum: number;
    maximum: number;
    mean: number;
  };
  timings: {
    embedding_ms: number;
    total_ms: number;
  };
  cold_start: boolean;
  cache_hit: boolean;
}

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(errorMessage(detail));
    this.status = status;
    this.detail = detail;
  }
}

export const errorMessage = (value: unknown): string => {
  if (value instanceof Error) return value.message;
  if (value && typeof value === "object") {
    const root = value as Record<string, unknown>;
    const detail = root.detail;
    if (detail && typeof detail === "object" && "message" in detail) {
      return String((detail as Record<string, unknown>).message);
    }
    if (typeof detail === "string") return detail;
    if ("message" in root) return String(root.message);
  }
  return "Request failed.";
};

const API_PREFIX = "/api/elasticsearch";

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      throw error;
    }
    throw new ApiError(0, {
      detail: { message: error instanceof Error ? error.message : "Network error." },
    });
  }
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { detail: { message: text || response.statusText } };
  }
  if (!response.ok) throw new ApiError(response.status, body);
  return body as T;
};

export const api = {
  health: () => request<ElasticsearchHealth>("/health"),
  indices: () => request<IndicesResult>("/indices"),
  schema: (index: string) =>
    request<IndexSchema>(`/indices/${encodeURIComponent(index)}/schema`),
  inferenceEndpoints: () => request<InferenceResult>("/inference/endpoints"),
  model: () => request<ModelStatus>("/model"),
  loadModel: () => request<ModelStatus>("/model/load", { method: "POST" }),
  clearModelCache: () => request<{ cleared: number; model: ModelStatus }>("/model/cache", {
    method: "DELETE",
  }),
  previewEmbedding: (text: string, signal?: AbortSignal) =>
    request<EmbeddingPreview>("/model/preview", {
      method: "POST",
      body: JSON.stringify({ text }),
      signal,
    }),
  search: (payload: SearchPayload, signal?: AbortSignal) =>
    request<SearchResult>("/search", {
      method: "POST",
      body: JSON.stringify(payload),
      signal,
    }),
};
