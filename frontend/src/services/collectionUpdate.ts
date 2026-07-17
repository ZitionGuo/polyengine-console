export interface CollectionUpdateFormValues {
  replicationFactor?: number;
  writeConsistencyFactor?: number;
  onDiskPayload?: boolean;
  indexingThreshold?: number;
  flushIntervalSec?: number;
  hnswM?: number;
  hnswEfConstruct?: number;
  advancedJson?: string;
}

const compactObject = (input: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );

const mergeObjects = (
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
      result[key] = mergeObjects(
        current as Record<string, unknown>,
        value as Record<string, unknown>,
      );
      return;
    }
    result[key] = value;
  });
  return result;
};

const parseAdvancedJson = (input?: string): Record<string, unknown> => {
  if (!input?.trim()) return {};
  const parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Advanced JSON must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
};

export const buildCollectionUpdatePayload = (
  values: CollectionUpdateFormValues,
): Record<string, unknown> => {
  const payload = compactObject({
    params: compactObject({
      replication_factor: values.replicationFactor,
      write_consistency_factor: values.writeConsistencyFactor,
      on_disk_payload: values.onDiskPayload,
    }),
    optimizers_config: compactObject({
      indexing_threshold: values.indexingThreshold,
      flush_interval_sec: values.flushIntervalSec,
    }),
    hnsw_config: compactObject({
      m: values.hnswM,
      ef_construct: values.hnswEfConstruct,
    }),
  });

  Object.keys(payload).forEach((key) => {
    if (Object.keys(payload[key] as Record<string, unknown>).length === 0) {
      delete payload[key];
    }
  });

  const merged = mergeObjects(payload, parseAdvancedJson(values.advancedJson));
  if (!Object.keys(merged).length) {
    throw new Error("Choose at least one setting to update.");
  }
  return merged;
};
