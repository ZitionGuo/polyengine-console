import type { CollectionCreateBody } from "./collectionPayload";

export interface QdrantEnvelope<T = unknown> {
  result?: T;
  status?: string;
  time?: number;
  [key: string]: unknown;
}

export interface CollectionSummary {
  name: string;
}

export interface CollectionOverviewError {
  name: string;
  status_code?: number | null;
  detail?: unknown;
}

export interface CollectionOverview extends CollectionSummary {
  status?: string | null;
  optimizer_status?: unknown;
  points_count?: number | null;
  vectors_count?: number | null;
  indexed_vectors_count?: number | null;
  segments_count?: number | null;
  dense_vector_count?: number | null;
  sparse_vector_count?: number | null;
  update_queue_length?: number | null;
  error?: CollectionOverviewError;
}

export interface CollectionOverviewResult {
  collections: CollectionOverview[];
  errors: CollectionOverviewError[];
}

export interface AliasSummary {
  alias_name: string;
  collection_name: string;
}

export interface AliasUpdatePayload {
  new_alias_name?: string;
  collection_name?: string;
}

export interface CollectionSnapshot {
  name: string;
  size: number;
  creation_time: string;
  checksum?: string;
}

export type SnapshotPriority = "snapshot" | "replica" | "no_sync";

export interface SnapshotRestoreOptions {
  priority: SnapshotPriority;
  checksum?: string;
}

export interface CollectionIndexError {
  field_name: string;
  field_schema: unknown;
  status_code?: number | null;
  detail?: unknown;
}

export interface CollectionCreateResult {
  collection: unknown;
  indexes: unknown[];
  index_errors: CollectionIndexError[];
}

export interface OptimizationSegment {
  uuid?: string;
  points_count?: number;
}

export interface OptimizationProgress {
  name?: string;
  started_at?: string;
  finished_at?: string;
  duration_sec?: number;
  done?: number;
  total?: number;
}

export interface OptimizationItem {
  uuid?: string;
  optimizer?: string;
  status?: string;
  segments?: OptimizationSegment[];
  progress?: OptimizationProgress;
}

export interface CollectionOptimizations {
  summary?: {
    queued_optimizations?: number;
    queued_segments?: number;
    queued_points?: number;
    idle_segments?: number;
  };
  running?: OptimizationItem[];
  queued?: OptimizationItem[];
  completed?: OptimizationItem[];
  idle_segments?: OptimizationSegment[];
}

export interface RestProxyPayload {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
}

export interface RestProxyResult {
  status_code: number;
  headers: Record<string, string>;
  duration_ms: number | null;
  body: unknown;
}

export interface PointsScrollPayload {
  limit?: number;
  offset?: unknown;
  filter?: Record<string, unknown>;
  with_payload?: boolean | string[] | Record<string, unknown>;
  with_vector?: boolean | string[];
}

export interface PointsQueryPayload {
  query: unknown;
  using?: string;
  filter?: Record<string, unknown>;
  params?: Record<string, unknown>;
  limit?: number;
  offset?: unknown;
  with_payload?: boolean | string[] | Record<string, unknown>;
  with_vector?: boolean | string[];
  score_threshold?: number;
}

export interface PointsRetrievePayload {
  ids: unknown[];
  with_payload?: boolean | string[] | Record<string, unknown>;
  with_vector?: boolean | string[];
}

export interface PointsCountPayload {
  filter?: Record<string, unknown>;
  exact?: boolean;
  shard_key?: unknown;
}

export interface PointsFacetPayload {
  key: string;
  limit?: number;
  filter?: Record<string, unknown>;
  exact?: boolean;
  shard_key?: unknown;
}

export interface PointsFacetHit {
  value: unknown;
  count: number;
}

export interface PointsDeletePayload {
  points: unknown[];
  wait?: boolean;
  ordering?: "weak" | "medium" | "strong";
}

export interface PointsUpsertPayload {
  points: Array<Record<string, unknown>>;
  wait?: boolean;
  ordering?: "weak" | "medium" | "strong";
}

export interface PointsPayloadOverwritePayload {
  pointId: unknown;
  payload: Record<string, unknown>;
  wait?: boolean;
  ordering?: "weak" | "medium" | "strong";
}

export interface PointsPayloadClearPayload {
  pointId: unknown;
  wait?: boolean;
  ordering?: "weak" | "medium" | "strong";
}

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(extractErrorMessage(detail));
    this.status = status;
    this.detail = detail;
  }
}

const API_PREFIX = "/api/qdrant";

const apiPath = (path: string) => `${API_PREFIX}${path}`;

const extractErrorMessage = (detail: unknown) => {
  if (detail && typeof detail === "object" && "detail" in detail) {
    const nested = (detail as { detail?: unknown }).detail;
    if (nested && typeof nested === "object" && "message" in nested) {
      const upstreamStatus = (nested as { upstream_status?: unknown }).upstream_status;
      const upstreamBody = (nested as { upstream_body?: unknown }).upstream_body;
      const pieces = [String((nested as { message: unknown }).message)];
      if (upstreamStatus) {
        pieces.push(`upstream ${String(upstreamStatus)}`);
      }
      if (upstreamBody) {
        pieces.push(typeof upstreamBody === "string" ? upstreamBody : JSON.stringify(upstreamBody));
      }
      return pieces.join(" - ");
    }
    return JSON.stringify(nested);
  }
  return "Request failed.";
};

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  let response: Response;
  const isMultipart =
    typeof FormData !== "undefined" && init.body instanceof FormData;
  try {
    response = await fetch(apiPath(path.replace(/^\/api/, "")), {
      ...init,
      headers: {
        ...(isMultipart ? {} : { "Content-Type": "application/json" }),
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    throw new ApiError(0, {
      detail: {
        message: error instanceof Error ? error.message : "Network request failed.",
        upstream_status: null,
        upstream_body: null,
      },
    });
  }

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: { message: text || response.statusText } };
  }
  if (!response.ok) {
    throw new ApiError(response.status, data);
  }
  return data as T;
};

export const api = {
  health: () => request<{ status: string; qdrant: unknown }>("/api/health"),

  listCollections: () =>
    request<QdrantEnvelope<{ collections: CollectionSummary[] }>>("/api/collections"),

  listCollectionOverview: () =>
    request<QdrantEnvelope<CollectionOverviewResult>>(
      "/api/collections?include_details=true",
    ),

  getCollection: (name: string) =>
    request<QdrantEnvelope<Record<string, unknown>>>(`/api/collections/${encodeURIComponent(name)}`),

  createCollection: (name: string, body: CollectionCreateBody) =>
    request<CollectionCreateResult>(`/api/collections/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  deleteCollection: (name: string) =>
    request<QdrantEnvelope>(`/api/collections/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),

  updateCollection: (name: string, body: Record<string, unknown>) =>
    request<QdrantEnvelope>(`/api/collections/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  listCollectionSnapshots: (name: string) =>
    request<QdrantEnvelope<CollectionSnapshot[]>>(
      `/api/collections/${encodeURIComponent(name)}/snapshots`,
    ),

  createCollectionSnapshot: (name: string) =>
    request<QdrantEnvelope<CollectionSnapshot>>(
      `/api/collections/${encodeURIComponent(name)}/snapshots?wait=true`,
      { method: "POST" },
    ),

  collectionSnapshotDownloadUrl: (name: string, snapshotName: string) =>
    apiPath(
      `/collections/${encodeURIComponent(name)}/snapshots/${encodeURIComponent(snapshotName)}`,
    ),

  deleteCollectionSnapshot: (name: string, snapshotName: string) =>
    request<QdrantEnvelope>(
      `/api/collections/${encodeURIComponent(name)}/snapshots/${encodeURIComponent(snapshotName)}?wait=true`,
      { method: "DELETE" },
    ),

  uploadCollectionSnapshot: (
    name: string,
    snapshot: File,
    options: SnapshotRestoreOptions,
  ) => {
    const query = new URLSearchParams({
      wait: "true",
      priority: options.priority,
    });
    if (options.checksum) query.set("checksum", options.checksum);
    const body = new FormData();
    body.append("snapshot", snapshot, snapshot.name);
    return request<QdrantEnvelope>(
      `/api/collections/${encodeURIComponent(name)}/snapshots/upload?${query}`,
      { method: "POST", body },
    );
  },

  listStorageSnapshots: () =>
    request<QdrantEnvelope<CollectionSnapshot[]>>("/api/snapshots"),

  createStorageSnapshot: () =>
    request<QdrantEnvelope<CollectionSnapshot>>("/api/snapshots?wait=true", {
      method: "POST",
    }),

  storageSnapshotDownloadUrl: (snapshotName: string) =>
    apiPath(`/snapshots/${encodeURIComponent(snapshotName)}`),

  deleteStorageSnapshot: (snapshotName: string) =>
    request<QdrantEnvelope>(
      `/api/snapshots/${encodeURIComponent(snapshotName)}?wait=true`,
      { method: "DELETE" },
    ),

  getCollectionOptimizations: (name: string, completedLimit = 8) =>
    request<QdrantEnvelope<CollectionOptimizations>>(
      `/api/collections/${encodeURIComponent(name)}/optimizations?${new URLSearchParams({
        completed_limit: String(completedLimit),
      })}`,
    ),

  createIndex: (collectionName: string, fieldName: string, fieldSchema: unknown) =>
    request<QdrantEnvelope>(`/api/collections/${encodeURIComponent(collectionName)}/indexes`, {
      method: "PUT",
      body: JSON.stringify({ field_name: fieldName, field_schema: fieldSchema }),
    }),

  deleteIndex: (collectionName: string, fieldName: string) =>
    request<QdrantEnvelope>(
      `/api/collections/${encodeURIComponent(collectionName)}/indexes/${encodeURIComponent(fieldName)}`,
      { method: "DELETE" },
    ),

  scrollPoints: (collectionName: string, payload: PointsScrollPayload) =>
    request<QdrantEnvelope<Record<string, unknown>>>(
      `/api/collections/${encodeURIComponent(collectionName)}/points/scroll`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),

  queryPoints: (collectionName: string, payload: PointsQueryPayload) =>
    request<QdrantEnvelope<Record<string, unknown>>>(
      `/api/collections/${encodeURIComponent(collectionName)}/points/query`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),

  retrievePoints: (collectionName: string, payload: PointsRetrievePayload) =>
    request<QdrantEnvelope<Record<string, unknown>>>(
      `/api/collections/${encodeURIComponent(collectionName)}/points/retrieve`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),

  countPoints: (collectionName: string, payload: PointsCountPayload) =>
    request<QdrantEnvelope<{ count: number }>>(
      `/api/collections/${encodeURIComponent(collectionName)}/points/count`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),

  facetPoints: (collectionName: string, payload: PointsFacetPayload) =>
    request<QdrantEnvelope<{ hits: PointsFacetHit[] }>>(
      `/api/collections/${encodeURIComponent(collectionName)}/points/facet`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),

  deletePoints: (collectionName: string, payload: PointsDeletePayload) =>
    request<QdrantEnvelope>(
      `/api/collections/${encodeURIComponent(collectionName)}/points/delete?${new URLSearchParams({
        wait: String(payload.wait ?? true),
        ...(payload.ordering ? { ordering: payload.ordering } : {}),
      })}`,
      {
        method: "POST",
        body: JSON.stringify({ points: payload.points }),
      },
    ),

  upsertPoints: (collectionName: string, payload: PointsUpsertPayload) =>
    request<QdrantEnvelope>(
      `/api/collections/${encodeURIComponent(collectionName)}/points?${new URLSearchParams({
        wait: String(payload.wait ?? true),
        ...(payload.ordering ? { ordering: payload.ordering } : {}),
      })}`,
      {
        method: "PUT",
        body: JSON.stringify({ points: payload.points }),
      },
    ),

  overwritePointPayload: (
    collectionName: string,
    payload: PointsPayloadOverwritePayload,
  ) =>
    request<QdrantEnvelope>(
      `/api/collections/${encodeURIComponent(collectionName)}/points/payload?${new URLSearchParams({
        wait: String(payload.wait ?? true),
        ...(payload.ordering ? { ordering: payload.ordering } : {}),
      })}`,
      {
        method: "PUT",
        body: JSON.stringify({ points: [payload.pointId], payload: payload.payload }),
      },
    ),

  clearPointPayload: (collectionName: string, payload: PointsPayloadClearPayload) =>
    request<QdrantEnvelope>(
      `/api/collections/${encodeURIComponent(collectionName)}/points/payload/clear?${new URLSearchParams({
        wait: String(payload.wait ?? true),
        ...(payload.ordering ? { ordering: payload.ordering } : {}),
      })}`,
      {
        method: "POST",
        body: JSON.stringify({ points: [payload.pointId] }),
      },
    ),

  listAliases: () =>
    request<QdrantEnvelope<{ aliases: AliasSummary[] }>>("/api/aliases"),

  createAlias: (collectionName: string, aliasName: string) =>
    request<QdrantEnvelope>("/api/aliases", {
      method: "POST",
      body: JSON.stringify({ collection_name: collectionName, alias_name: aliasName }),
    }),

  renameAlias: (oldAlias: string, newAlias: string) =>
    request<QdrantEnvelope>(`/api/aliases/${encodeURIComponent(oldAlias)}`, {
      method: "PATCH",
      body: JSON.stringify({ new_alias_name: newAlias }),
    }),

  updateAlias: (oldAlias: string, payload: AliasUpdatePayload) =>
    request<QdrantEnvelope>(`/api/aliases/${encodeURIComponent(oldAlias)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deleteAlias: (aliasName: string) =>
    request<QdrantEnvelope>(`/api/aliases/${encodeURIComponent(aliasName)}`, {
      method: "DELETE",
    }),

  getCluster: () => request<QdrantEnvelope<Record<string, unknown>>>("/api/cluster"),

  getTelemetry: () => request<QdrantEnvelope<Record<string, unknown>>>("/api/cluster/telemetry"),

  getCollectionCluster: (collectionName: string) =>
    request<QdrantEnvelope<Record<string, unknown>>>(
      `/api/collections/${encodeURIComponent(collectionName)}/cluster`,
    ),

  restProxy: (payload: RestProxyPayload) =>
    request<RestProxyResult>("/api/rest", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
