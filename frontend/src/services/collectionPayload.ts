export type VectorDistance = "Cosine" | "Euclid" | "Dot" | "Manhattan";

export type PayloadIndexType =
  | "keyword"
  | "integer"
  | "float"
  | "bool"
  | "geo"
  | "datetime"
  | "text"
  | "uuid";

export interface VectorInput {
  name?: string;
  size?: number;
  distance?: VectorDistance;
  onDisk?: boolean;
}

export interface SparseVectorInput {
  name?: string;
  modifier?: "idf" | "none";
  onDisk?: boolean;
}

export interface IndexInput {
  fieldName?: string;
  type?: PayloadIndexType;
  onDisk?: boolean;
  isTenant?: boolean;
  tokenizer?: "prefix" | "whitespace" | "word" | "multilingual";
  minTokenLen?: number;
  maxTokenLen?: number;
  lowercase?: boolean;
}

export interface CollectionFormValues {
  name?: string;
  vectorMode?: "single" | "named";
  singleVector?: VectorInput;
  namedVectors?: VectorInput[];
  sparseVectors?: SparseVectorInput[];
  shardNumber?: number;
  replicationFactor?: number;
  writeConsistencyFactor?: number;
  onDiskPayload?: boolean;
  advancedJson?: string;
  indexes?: IndexInput[];
}

export interface CollectionCreateBody {
  config: Record<string, unknown>;
  indexes: Array<{ field_name: string; field_schema: unknown }>;
}

const isDefined = <T>(value: T | undefined | null): value is T =>
  value !== undefined && value !== null && value !== "";

const compactObject = <T extends Record<string, unknown>>(input: T): Partial<T> =>
  Object.fromEntries(Object.entries(input).filter(([, value]) => isDefined(value))) as Partial<T>;

const buildDenseVector = (input: VectorInput = {}) => {
  if (!input.size || !input.distance) {
    throw new Error("Vector size and distance are required.");
  }
  return compactObject({
    size: input.size,
    distance: input.distance,
    on_disk: input.onDisk,
  });
};

const deepMerge = (
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> => {
  const result = { ...base };
  Object.entries(override).forEach(([key, value]) => {
    const current = result[key];
    if (
      current &&
      value &&
      typeof current === "object" &&
      typeof value === "object" &&
      !Array.isArray(current) &&
      !Array.isArray(value)
    ) {
      result[key] = deepMerge(current as Record<string, unknown>, value as Record<string, unknown>);
      return;
    }
    result[key] = value;
  });
  return result;
};

const parseAdvancedJson = (advancedJson?: string): Record<string, unknown> => {
  if (!advancedJson?.trim()) {
    return {};
  }
  const parsed = JSON.parse(advancedJson);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Advanced JSON must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
};

export const buildIndexSchema = (index: IndexInput): unknown => {
  if (!index.type) {
    throw new Error("Index type is required.");
  }

  const extras = compactObject({
    on_disk: index.onDisk,
    is_tenant: index.isTenant,
  });

  if (index.type === "text") {
    return compactObject({
      type: "text",
      tokenizer: index.tokenizer ?? "word",
      min_token_len: index.minTokenLen,
      max_token_len: index.maxTokenLen,
      lowercase: index.lowercase,
      on_disk: index.onDisk,
    });
  }

  if (Object.keys(extras).length > 0) {
    return { type: index.type, ...extras };
  }

  return index.type;
};

export const buildCollectionCreatePayload = (
  values: CollectionFormValues,
): { name: string; body: CollectionCreateBody } => {
  const name = values.name?.trim();
  if (!name) {
    throw new Error("Collection name is required.");
  }

  const vectorMode = values.vectorMode ?? "single";
  const config: Record<string, unknown> = compactObject({
    shard_number: values.shardNumber,
    replication_factor: values.replicationFactor,
    write_consistency_factor: values.writeConsistencyFactor,
    on_disk_payload: values.onDiskPayload,
  });

  if (vectorMode === "named") {
    const namedVectors = values.namedVectors?.filter((vector) => vector.name?.trim()) ?? [];
    if (!namedVectors.length) {
      throw new Error("At least one named vector is required.");
    }
    config.vectors = Object.fromEntries(
      namedVectors.map((vector) => [vector.name?.trim(), buildDenseVector(vector)]),
    );
  } else {
    config.vectors = buildDenseVector(values.singleVector);
  }

  const sparseVectors = values.sparseVectors?.filter((vector) => vector.name?.trim()) ?? [];
  if (sparseVectors.length) {
    config.sparse_vectors = Object.fromEntries(
      sparseVectors.map((vector) => [
        vector.name?.trim(),
        compactObject({
          modifier: vector.modifier && vector.modifier !== "none" ? vector.modifier : undefined,
          index: vector.onDisk === undefined ? undefined : { on_disk: vector.onDisk },
        }),
      ]),
    );
  }

  const advanced = parseAdvancedJson(values.advancedJson);
  const indexes =
    values.indexes
      ?.filter((index) => index.fieldName?.trim())
      .map((index) => ({
        field_name: index.fieldName!.trim(),
        field_schema: buildIndexSchema(index),
      })) ?? [];

  return {
    name,
    body: {
      config: deepMerge(config, advanced),
      indexes,
    },
  };
};
