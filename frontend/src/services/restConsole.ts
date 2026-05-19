export const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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
