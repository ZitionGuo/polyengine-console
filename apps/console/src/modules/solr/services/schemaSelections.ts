export const retainAvailableValues = (
  current: string[] | undefined,
  available: string[],
  fallback: string[],
  fallbackWhenEmpty: boolean,
): string[] => {
  const availableSet = new Set(available);
  const retained = current
    ? [...new Set(current)].filter((value) => availableSet.has(value))
    : [];
  if (retained.length || (current !== undefined && !fallbackWhenEmpty)) {
    return retained;
  }
  return [...new Set(fallback)].filter((value) => availableSet.has(value));
};
