export const clearSelectedThresholds = (
  selectedFields: string[],
  thresholds: Record<string, number | null>,
): Record<string, number | null> => {
  const selected = new Set(selectedFields);
  return Object.fromEntries(
    Object.entries(thresholds).map(([field, value]) => [
      field,
      selected.has(field) ? null : value,
    ]),
  );
};

export const hasSelectedThreshold = (
  selectedFields: string[],
  thresholds: Record<string, number | null | undefined>,
): boolean => selectedFields.some((field) => thresholds[field] !== null && thresholds[field] !== undefined);
