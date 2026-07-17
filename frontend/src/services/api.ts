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

export interface AliasSummary {
  alias_name: string;
  collection_name: string;
}

export interface RestProxyPayload {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
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

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(extractErrorMessage(detail));
    this.status = status;
    this.detail = detail;
  }
}

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
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
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

  getCollection: (name: string) =>
    request<QdrantEnvelope<Record<string, unknown>>>(`/api/collections/${encodeURIComponent(name)}`),

  createCollection: (name: string, body: CollectionCreateBody) =>
    request<{
      collection: unknown;
      indexes: unknown[];
      index_errors: unknown[];
    }>(`/api/collections/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  deleteCollection: (name: string) =>
    request<QdrantEnvelope>(`/api/collections/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),

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
    request<unknown>("/api/rest", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
