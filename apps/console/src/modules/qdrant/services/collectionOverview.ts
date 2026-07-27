import type { CollectionOverview } from "./api";

export type CollectionHealth =
  | "healthy"
  | "optimizing"
  | "degraded"
  | "unavailable"
  | "unknown";

export type CollectionHealthFilter = "all" | CollectionHealth;

export interface CollectionHealthPresentation {
  health: CollectionHealth;
  label: string;
  color?: string;
}

const optimizerHasError = (value: unknown) => {
  if (typeof value === "string") return value.toLowerCase() === "error";
  return Boolean(value && typeof value === "object" && "error" in value);
};

export const getCollectionHealth = (
  collection: CollectionOverview,
): CollectionHealthPresentation => {
  const status = collection.status?.toLowerCase();

  if (collection.error || status === "unavailable") {
    return { health: "unavailable", label: "Unavailable", color: "red" };
  }
  if (status === "red" || optimizerHasError(collection.optimizer_status)) {
    return { health: "degraded", label: "Degraded", color: "red" };
  }
  if (status === "yellow") {
    return { health: "optimizing", label: "Optimizing", color: "gold" };
  }
  if (status === "grey" || status === "gray") {
    return { health: "optimizing", label: "Pending", color: "default" };
  }
  if (status === "green") {
    return { health: "healthy", label: "Healthy", color: "green" };
  }
  return { health: "unknown", label: "Unknown" };
};

export const filterCollectionOverview = (
  collections: CollectionOverview[],
  search: string,
  healthFilter: CollectionHealthFilter,
) => {
  const normalizedSearch = search.trim().toLowerCase();
  return collections.filter((collection) => {
    const matchesSearch =
      !normalizedSearch || collection.name.toLowerCase().includes(normalizedSearch);
    const matchesHealth =
      healthFilter === "all" || getCollectionHealth(collection).health === healthFilter;
    return matchesSearch && matchesHealth;
  });
};

export const formatCollectionMetric = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat().format(value)
    : "-";

export const describeCollectionOverviewError = (collection: CollectionOverview) => {
  const detail = collection.error?.detail;
  if (!detail) return "Collection details are unavailable.";
  if (typeof detail === "string") return detail;
  if (typeof detail === "object" && "message" in detail) {
    return String((detail as { message: unknown }).message);
  }
  return JSON.stringify(detail);
};
