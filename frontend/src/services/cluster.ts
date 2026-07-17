export type ClusterMode = "enabled" | "disabled" | "unknown";

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const getClusterMode = (response: unknown): ClusterMode => {
  const root = asRecord(response);
  const result = asRecord(root.result ?? response);
  return result.status === "enabled" || result.status === "disabled"
    ? result.status
    : "unknown";
};

export const shouldRequestCollectionCluster = (
  collectionSelected: boolean,
  clusterStatusLoaded: boolean,
  mode: ClusterMode,
) => collectionSelected && clusterStatusLoaded && mode === "enabled";

export const shouldRequestCollectionDetails = (
  collectionSelected: boolean,
  clusterStatusSettled: boolean,
  mode: ClusterMode,
  collectionClusterFailed: boolean,
) =>
  collectionSelected &&
  clusterStatusSettled &&
  (mode !== "enabled" || collectionClusterFailed);
