import type { CollectionIndexError } from "./api";

export interface RetryableIndexFailure {
  key: string;
  collectionName: string;
  fieldName: string;
  fieldSchema: unknown;
  statusCode?: number | null;
  detail?: unknown;
  message: string;
}

const stringifyDetail = (value: unknown) => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const describeIndexFailure = (detail: unknown) => {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
    return stringifyDetail(detail ?? "Unknown index error");
  }
  const record = detail as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message : "Index creation failed.";
  const upstream = record.upstream_body;
  return upstream === undefined || upstream === null
    ? message
    : `${message} ${stringifyDetail(upstream)}`;
};

export const buildRetryableIndexFailures = (
  collectionName: string,
  errors: CollectionIndexError[],
): RetryableIndexFailure[] =>
  errors.map((error, index) => ({
    key: `${collectionName}:${error.field_name}:${index}`,
    collectionName,
    fieldName: error.field_name,
    fieldSchema: error.field_schema,
    statusCode: error.status_code,
    detail: error.detail,
    message: describeIndexFailure(error.detail),
  }));

export const parseRetryIndexSchema = (value: string): unknown => {
  if (!value.trim()) throw new Error("Index schema JSON is required.");
  const parsed = JSON.parse(value);
  if (
    typeof parsed !== "string" &&
    (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
  ) {
    throw new Error("Index schema must be a JSON string or object.");
  }
  return parsed;
};
