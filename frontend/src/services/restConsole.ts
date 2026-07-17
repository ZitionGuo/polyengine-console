export const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type RestConsoleMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface RestTemplate {
  key: string;
  label: string;
  description: string;
  method: RestConsoleMethod;
  path: string;
  queryText: string;
  bodyText: string;
}

export const restTemplates: RestTemplate[] = [
  {
    key: "list-collections",
    label: "List collections",
    description: "Fetch the current collection list.",
    method: "GET",
    path: "/collections",
    queryText: "{}",
    bodyText: "{\n  \n}",
  },
  {
    key: "get-collection",
    label: "Get collection",
    description: "Inspect one collection by name.",
    method: "GET",
    path: "/collections/my_collection",
    queryText: "{}",
    bodyText: "{\n  \n}",
  },
  {
    key: "create-collection",
    label: "Create collection",
    description: "Create a dense-vector collection.",
    method: "PUT",
    path: "/collections/my_collection",
    queryText: "{}",
    bodyText: JSON.stringify(
      {
        vectors: {
          size: 384,
          distance: "Cosine",
        },
      },
      null,
      2,
    ),
  },
  {
    key: "create-index",
    label: "Create payload index",
    description: "Add a keyword payload index to a collection.",
    method: "PUT",
    path: "/collections/my_collection/index",
    queryText: "{}",
    bodyText: JSON.stringify(
      {
        field_name: "metadata.source",
        field_schema: "keyword",
      },
      null,
      2,
    ),
  },
  {
    key: "scroll-points",
    label: "Scroll points",
    description: "Preview point payloads from a collection.",
    method: "POST",
    path: "/collections/my_collection/points/scroll",
    queryText: "{}",
    bodyText: JSON.stringify(
      {
        limit: 10,
        with_payload: true,
        with_vector: false,
      },
      null,
      2,
    ),
  },
  {
    key: "filter-points",
    label: "Filter points",
    description: "Scroll points matching a payload filter.",
    method: "POST",
    path: "/collections/my_collection/points/scroll",
    queryText: "{}",
    bodyText: JSON.stringify(
      {
        limit: 10,
        with_payload: true,
        with_vector: false,
        filter: {
          must: [
            {
              key: "metadata.source",
              match: {
                value: "manual",
              },
            },
          ],
        },
      },
      null,
      2,
    ),
  },
  {
    key: "retrieve-points",
    label: "Retrieve points",
    description: "Fetch exact points by ID.",
    method: "POST",
    path: "/collections/my_collection/points",
    queryText: "{}",
    bodyText: JSON.stringify(
      {
        ids: [1],
        with_payload: true,
        with_vector: false,
      },
      null,
      2,
    ),
  },
  {
    key: "query-points",
    label: "Query points",
    description: "Search nearest points with a query vector.",
    method: "POST",
    path: "/collections/my_collection/points/query",
    queryText: "{}",
    bodyText: JSON.stringify(
      {
        query: [0.1, 0.2, 0.3, 0.4],
        limit: 10,
        with_payload: true,
        with_vector: false,
      },
      null,
      2,
    ),
  },
  {
    key: "upsert-points",
    label: "Upsert point",
    description: "Write or update a point in a dense-vector collection.",
    method: "PUT",
    path: "/collections/my_collection/points",
    queryText: JSON.stringify({ wait: true }, null, 2),
    bodyText: JSON.stringify(
      {
        points: [
          {
            id: 1,
            vector: [0.1, 0.2, 0.3, 0.4],
            payload: {
              source: "rest-console",
            },
          },
        ],
      },
      null,
      2,
    ),
  },
  {
    key: "update-aliases",
    label: "Create alias",
    description: "Map an alias to a collection with the Qdrant alias action API.",
    method: "POST",
    path: "/collections/aliases",
    queryText: "{}",
    bodyText: JSON.stringify(
      {
        actions: [
          {
            create_alias: {
              collection_name: "my_collection",
              alias_name: "my_collection_live",
            },
          },
        ],
      },
      null,
      2,
    ),
  },
  {
    key: "cluster-status",
    label: "Cluster status",
    description: "Read cluster mode and peer state.",
    method: "GET",
    path: "/cluster",
    queryText: "{}",
    bodyText: "{\n  \n}",
  },
  {
    key: "telemetry",
    label: "Telemetry",
    description: "Read Qdrant telemetry and version details.",
    method: "GET",
    path: "/telemetry",
    queryText: "{}",
    bodyText: "{\n  \n}",
  },
];

export const requiresConfirmation = (method: string) => MUTATING_METHODS.has(method.toUpperCase());

export const parseJsonObject = (value: string, label: string) => {
  if (!value.trim()) {
    return {};
  }
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
};

export const parseJsonBody = (value: string) => {
  if (!value.trim()) {
    return undefined;
  }
  return JSON.parse(value);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const looksLikePoint = (value: unknown) => isRecord(value) && "id" in value;

const summarizeResult = (value: unknown): string => {
  if (value === undefined || value === null) return "No result";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every(looksLikePoint)) {
      return pluralize(value.length, "point");
    }
    return pluralize(value.length, "item");
  }
  if (!isRecord(value)) return "Result returned";

  if (Array.isArray(value.collections)) return pluralize(value.collections.length, "collection");
  if (Array.isArray(value.aliases)) return pluralize(value.aliases.length, "alias", "aliases");
  if (Array.isArray(value.points)) return pluralize(value.points.length, "point");

  const keys = Object.keys(value);
  if (!keys.length) return "Empty object";
  return `${pluralize(keys.length, "field")}: ${keys.slice(0, 4).join(", ")}`;
};

export const summarizeResponse = (value: unknown) => {
  if (value instanceof Error) {
    return {
      status: "error",
      statusCode: null,
      time: "n/a",
      result: value.message,
    };
  }

  const proxyResponse = isRecord(value) && typeof value.status_code === "number" ? value : null;
  const responseBody = proxyResponse ? proxyResponse.body : value;
  const envelope = isRecord(responseBody) ? responseBody : {};
  const statusCode = proxyResponse ? (proxyResponse.status_code as number) : null;
  const status = statusCode
    ? statusCode >= 200 && statusCode < 400
      ? "ok"
      : "error"
    : typeof envelope.status === "string"
      ? envelope.status
      : "ok";
  const time =
    proxyResponse && typeof proxyResponse.duration_ms === "number"
      ? `${proxyResponse.duration_ms.toFixed(2)} ms`
      : typeof envelope.time === "number"
        ? `${(envelope.time * 1000).toFixed(2)} ms`
        : "n/a";
  const result = summarizeResult("result" in envelope ? envelope.result : responseBody);

  return { status, statusCode, time, result };
};
