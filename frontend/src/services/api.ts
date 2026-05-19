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
      return String((nested as { message: unknown }).message);
    }
    return JSON.stringify(nested);
  }
  return "Request failed.";
};

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
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
