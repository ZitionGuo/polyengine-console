export interface ModelStatus {
  name: string;
  dimension: number;
  status: "not_loaded" | "loading" | "ready" | "error";
  error?: string | null;
  query_cache?: {
    entries: number;
    capacity: number;
    ttl_seconds: number;
  };
}

export interface EmbeddingCacheClearResult {
  cleared: number;
  model: ModelStatus;
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
    model_load_ms: number;
    embedding_ms: number;
    total_ms: number;
  };
  cold_start: boolean;
  cache_hit: boolean;
}

export interface HealthResult {
  status: string;
  solr: { version?: string; mode: string; endpoint: string; admin_url: string };
  model: ModelStatus;
}

export interface SchemaField {
  name: string;
  type?: string;
  class?: string;
  indexed?: boolean;
  stored?: boolean;
  required?: boolean;
}

export interface VectorField extends SchemaField {
  dimension?: number | null;
  similarity_function?: string;
  vector_encoding?: string;
  compatible: boolean;
  reason?: string | null;
}

export interface CollectionSummary {
  name: string;
  document_count?: number | null;
  vector_fields: VectorField[];
  text_fields: SchemaField[];
  ready: boolean;
  error?: unknown;
}

export interface CollectionsResult {
  collections: CollectionSummary[];
  model_dimension: number;
}

export interface CollectionSchema {
  collection: string;
  unique_key?: string | null;
  fields: SchemaField[];
  vector_fields: VectorField[];
  text_fields: SchemaField[];
}

export interface SearchPayload {
  collection: string;
  mode: "semantic" | "hybrid";
  hybrid_strategy: "rerank" | "rrf";
  text: string;
  vector_field: string;
  lexical_fields: string[];
  lexical_boosts: Record<string, number>;
  limit: number;
  vector_candidates: number;
  lexical_candidates: number;
  rerank_docs: number;
  rerank_weight: number;
  lexical_weight: number;
  vector_weight: number;
  hybrid_rrf_k: number;
  timeout_ms?: number;
  min_score: number | null;
  filters: string[];
  return_fields: string[];
}

export interface SearchTimings {
  schema_ms: number;
  model_load_ms: number;
  embedding_ms: number;
  solr_ms: number;
  fusion_ms: number;
  overhead_ms: number;
  total_ms: number;
  cold_start: boolean;
  embedding_cache_hit: boolean;
}

export interface SearchResult {
  collection: string;
  vector_field: string;
  mode: "semantic" | "hybrid";
  hybrid_strategy: "rerank" | "rrf";
  fusion_method?: "weighted_rrf";
  source_weights?: Record<string, number>;
  rrf_k?: number;
  field_results?: CompareSearchItem[];
  model: string;
  dimension: number;
  timings: SearchTimings;
  response: {
    responseHeader?: Record<string, unknown>;
    response?: { numFound?: number; start?: number; docs?: Array<Record<string, unknown>> };
    [key: string]: unknown;
  };
}

export interface CompareSearchPayload extends Omit<SearchPayload, "vector_field"> {
  vector_fields: string[];
  vector_min_scores: Record<string, number>;
}

export interface CompareSearchItem {
  vector_field: string;
  status: "ok" | "error" | "skipped";
  solr_ms?: number;
  returned?: number;
  num_found?: number;
  score_samples?: number[];
  response?: SearchResult["response"];
  error?: unknown;
  reason?: string;
  source_results?: CompareSearchItem[];
}

export interface CompareSearchResult {
  collection: string;
  vector_fields: string[];
  vector_min_scores: Record<string, number>;
  mode: "semantic" | "hybrid";
  hybrid_strategy: "rerank" | "rrf";
  lexical_weight?: number;
  vector_weight?: number;
  rrf_k?: number | null;
  model: string;
  dimension: number;
  embedding_ms: number;
  total_ms: number;
  timings: SearchTimings;
  results: CompareSearchItem[];
}

export interface FuseSearchPayload extends Omit<SearchPayload, "vector_field"> {
  vector_fields: string[];
  vector_min_scores: Record<string, number>;
  vector_weights: Record<string, number>;
  fusion_candidates: number;
  rrf_k: number;
}

export interface FuseSearchResult {
  collection: string;
  vector_fields: string[];
  vector_min_scores: Record<string, number>;
  vector_weights: Record<string, number>;
  mode: "semantic" | "hybrid";
  hybrid_strategy: "rerank" | "rrf";
  fusion_method: "weighted_rrf";
  fusion_candidates: number;
  rrf_k: number;
  lexical_weight?: number;
  source_weights?: Record<string, number>;
  model: string;
  dimension: number;
  embedding_ms: number;
  total_ms: number;
  timings: SearchTimings;
  field_results: CompareSearchItem[];
  response: SearchResult["response"];
}

export interface UploadResult {
  upload_id: string;
  filename: string;
  format: "json" | "jsonl" | "csv";
  size: number;
  fields: string[];
  preview: Array<Record<string, unknown>>;
  total: number;
  expires_at: string;
}

export interface IngestVectorTarget {
  vector_field: string;
  text_fields: string[];
}

export interface IngestJobPayload {
  upload_id: string;
  collection: string;
  id_field: string;
  vector_targets: IngestVectorTarget[];
  batch_size: number;
  commit_within_ms: number;
}

export interface IngestJob {
  id: string;
  collection: string;
  filename: string;
  vector_targets: IngestVectorTarget[];
  retry_of?: string | null;
  retryable_rows: number;
  status: "queued" | "running" | "completed" | "cancelled" | "failed";
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  throughput?: number | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface IngestErrorRow {
  row: number;
  document_id: string;
  message: string;
}

export interface IngestErrorPage {
  items: IngestErrorRow[];
  total: number;
  offset: number;
  limit: number;
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

const API_PREFIX = "/api/solr";

const apiPath = (path: string) => `${API_PREFIX}${path}`;

export const errorMessage = (value: unknown): string => {
  if (value instanceof Error) return value.message;
  if (value && typeof value === "object" && "detail" in value) {
    const detail = (value as { detail: unknown }).detail;
    if (detail && typeof detail === "object" && "message" in detail) {
      return String((detail as { message: unknown }).message);
    }
    return typeof detail === "string" ? detail : JSON.stringify(detail);
  }
  return "Request failed.";
};

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  let response: Response;
  try {
    const multipart = typeof FormData !== "undefined" && init.body instanceof FormData;
    response = await fetch(apiPath(path.replace(/^\/api/, "")), {
      ...init,
      headers: {
        ...(multipart ? {} : { "Content-Type": "application/json" }),
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "name" in error
      && error.name === "AbortError"
    ) throw error;
    throw new ApiError(0, { detail: { message: error instanceof Error ? error.message : "Network error." } });
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
  health: () => request<HealthResult>("/api/health"),
  model: () => request<ModelStatus>("/api/model"),
  loadModel: () => request<ModelStatus>("/api/model/load", { method: "POST" }),
  clearEmbeddingCache: () =>
    request<EmbeddingCacheClearResult>("/api/model/cache", { method: "DELETE" }),
  previewEmbedding: (text: string, signal?: AbortSignal) =>
    request<EmbeddingPreview>("/api/model/embed", {
      method: "POST",
      body: JSON.stringify({ text }),
      signal,
    }),
  collections: () => request<CollectionsResult>("/api/collections"),
  refreshCollections: () => request<CollectionsResult>("/api/collections?refresh=true"),
  schema: (collection: string) =>
    request<CollectionSchema>(`/api/collections/${encodeURIComponent(collection)}/schema`),
  refreshSchema: (collection: string) =>
    request<CollectionSchema>(
      `/api/collections/${encodeURIComponent(collection)}/schema?refresh=true`,
    ),
  search: (payload: SearchPayload, signal?: AbortSignal) =>
    request<SearchResult>("/api/search", { method: "POST", body: JSON.stringify(payload), signal }),
  compareSearch: (payload: CompareSearchPayload, signal?: AbortSignal) =>
    request<CompareSearchResult>("/api/search/compare", { method: "POST", body: JSON.stringify(payload), signal }),
  fuseSearch: (payload: FuseSearchPayload, signal?: AbortSignal) =>
    request<FuseSearchResult>("/api/search/fuse", { method: "POST", body: JSON.stringify(payload), signal }),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    form.append("file_format", "auto");
    return request<UploadResult>("/api/ingest/uploads", { method: "POST", body: form });
  },
  createJob: (payload: IngestJobPayload) =>
    request<IngestJob>("/api/ingest/jobs", { method: "POST", body: JSON.stringify(payload) }),
  jobs: () => request<{ jobs: IngestJob[] }>("/api/ingest/jobs"),
  cancelJob: (id: string) => request<IngestJob>(`/api/ingest/jobs/${id}/cancel`, { method: "POST" }),
  retryJob: (id: string) =>
    request<IngestJob>(`/api/ingest/jobs/${encodeURIComponent(id)}/retry`, { method: "POST" }),
  jobErrors: (id: string, offset: number, limit: number, signal?: AbortSignal) =>
    request<IngestErrorPage>(
      `/api/ingest/jobs/${encodeURIComponent(id)}/error-rows?offset=${offset}&limit=${limit}`,
      { signal },
    ),
  jobErrorsUrl: (id: string) =>
    apiPath(`/ingest/jobs/${encodeURIComponent(id)}/errors`),
};
