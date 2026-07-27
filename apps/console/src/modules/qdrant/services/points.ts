import type {
  PointsCountPayload,
  PointsFacetPayload,
  PointsQueryPayload,
  PointsRetrievePayload,
  PointsScrollPayload,
} from "./api";

type PointInput = Record<string, unknown>;

export interface PointQueryInput {
  queryText: string;
  filterText: string;
  using?: string;
  limit?: number;
  withVector?: boolean;
}

export interface PointScrollInput {
  limit?: number;
  offset?: unknown;
  filterText?: string;
  withVector?: boolean;
}

export interface PointRetrieveInput {
  idsText: string;
  withVector?: boolean;
}

export interface PointCountInput {
  filterText?: string;
  exact?: boolean;
}

export interface PointFacetInput extends PointCountInput {
  key: string;
  limit?: number;
}

export const defaultPointsJson = `[
  {
    "id": 1,
    "vector": [0.1, 0.2, 0.3, 0.4],
    "payload": {
      "source": "manual"
    }
  }
]`;

export const defaultPointQueryJson = "[1, 0, 0, 0]";

export const defaultPointFilterJson = "{}";

export const defaultPointIdsJson = "[1]";

const isPointInput = (value: unknown): value is PointInput =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const parseJsonObject = (value: string, label: string) => {
  if (!value.trim()) {
    return {};
  }
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
};

const compactObject = <T extends Record<string, unknown>>(input: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  ) as Partial<T>;

export const parsePointFilter = (value: string) => parseJsonObject(value, "Filter");

export const parsePointPayloadInput = (value: string) => parseJsonObject(value, "Payload");

export const normalizePointFilterJson = (value: string) =>
  JSON.stringify(parsePointFilter(value), null, 2);

export const hasPointFilter = (value: string) => Object.keys(parsePointFilter(value)).length > 0;

export const parseUpsertPointsInput = (value: string) => {
  const parsed = JSON.parse(value);
  const points = Array.isArray(parsed) ? parsed : isPointInput(parsed) ? parsed.points : undefined;

  if (!Array.isArray(points) || points.length === 0) {
    throw new Error('Points must be a non-empty JSON array or an object with a "points" array.');
  }
  if (!points.every(isPointInput)) {
    throw new Error("Every point must be a JSON object.");
  }
  return points;
};

export const parsePointIdsInput = (value: string) => {
  const parsed = JSON.parse(value);
  const ids = Array.isArray(parsed) ? parsed : isPointInput(parsed) ? parsed.ids : undefined;

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('Point IDs must be a non-empty JSON array or an object with an "ids" array.');
  }
  return ids;
};

export const buildPointRetrievePayload = ({
  idsText,
  withVector,
}: PointRetrieveInput): PointsRetrievePayload => ({
  ids: parsePointIdsInput(idsText),
  with_payload: true,
  with_vector: Boolean(withVector),
});

export const buildPointScrollPayload = ({
  limit,
  offset,
  filterText = defaultPointFilterJson,
  withVector,
}: PointScrollInput): PointsScrollPayload => {
  const filter = parsePointFilter(filterText);
  const hasFilter = Object.keys(filter).length > 0;

  return compactObject({
    limit: limit ?? 10,
    offset,
    filter: hasFilter ? filter : undefined,
    with_payload: true,
    with_vector: Boolean(withVector),
  }) as PointsScrollPayload;
};

export const buildPointCountPayload = ({
  filterText = defaultPointFilterJson,
  exact = true,
}: PointCountInput): PointsCountPayload => {
  const filter = parsePointFilter(filterText);
  return {
    ...(Object.keys(filter).length ? { filter } : {}),
    exact,
  };
};

export const buildPointFacetPayload = ({
  key,
  limit = 10,
  filterText = defaultPointFilterJson,
  exact = false,
}: PointFacetInput): PointsFacetPayload => {
  const normalizedKey = key.trim();
  if (!normalizedKey) throw new Error("Facet field is required.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Facet limit must be an integer between 1 and 100.");
  }
  const filter = parsePointFilter(filterText);
  return {
    key: normalizedKey,
    limit,
    ...(Object.keys(filter).length ? { filter } : {}),
    exact,
  };
};

export const buildPointQueryPayload = ({
  queryText,
  filterText,
  using,
  limit,
  withVector,
}: PointQueryInput): PointsQueryPayload => {
  if (!queryText.trim()) {
    throw new Error("Query vector is required.");
  }

  const query = JSON.parse(queryText);
  const filter = parseJsonObject(filterText, "Filter");
  const hasFilter = Object.keys(filter).length > 0;

  return compactObject({
    query,
    using: using?.trim(),
    filter: hasFilter ? filter : undefined,
    limit: limit ?? 10,
    with_payload: true,
    with_vector: Boolean(withVector),
  }) as PointsQueryPayload;
};
