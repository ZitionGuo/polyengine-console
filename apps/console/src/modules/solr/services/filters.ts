import type { SchemaField } from "./api";

export type FilterKind = "text" | "number" | "boolean" | "date";
export type FilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "greater_than"
  | "greater_or_equal"
  | "less_than"
  | "less_or_equal"
  | "between"
  | "exists";

export interface FilterRule {
  id: string;
  field: string;
  operator: FilterOperator;
  value: string;
  secondValue: string;
}

export interface FilterOperatorOption {
  label: string;
  value: FilterOperator;
}

const textOperators: FilterOperatorOption[] = [
  { label: "Equals", value: "equals" },
  { label: "Does not equal", value: "not_equals" },
  { label: "Contains", value: "contains" },
  { label: "Exists", value: "exists" },
];

const orderedOperators: FilterOperatorOption[] = [
  { label: "Equals", value: "equals" },
  { label: "Does not equal", value: "not_equals" },
  { label: "Greater than", value: "greater_than" },
  { label: "At least", value: "greater_or_equal" },
  { label: "Less than", value: "less_than" },
  { label: "At most", value: "less_or_equal" },
  { label: "Between", value: "between" },
  { label: "Exists", value: "exists" },
];

const booleanOperators: FilterOperatorOption[] = [
  { label: "Equals", value: "equals" },
  { label: "Does not equal", value: "not_equals" },
  { label: "Exists", value: "exists" },
];

export const filterKind = (field?: SchemaField): FilterKind => {
  const signature = `${field?.type ?? ""} ${field?.class ?? ""}`.toLowerCase();
  if (signature.includes("bool")) return "boolean";
  if (signature.includes("date")) return "date";
  if (/(int|long|float|double|decimal|number)/.test(signature)) return "number";
  return "text";
};

export const operatorsForField = (field?: SchemaField): FilterOperatorOption[] => {
  const kind = filterKind(field);
  if (kind === "boolean") return booleanOperators;
  if (kind === "number" || kind === "date") return orderedOperators;
  return textOperators;
};

export const filterRuleComplete = (rule: FilterRule): boolean => {
  if (!rule.field) return false;
  if (rule.operator === "exists") return true;
  if (!rule.value.trim()) return false;
  return rule.operator !== "between" || Boolean(rule.secondValue.trim());
};

const escapeField = (value: string) => value.replace(/([+\-!(){}[\]^"~*?:\\/])/g, "\\$1");
const quotedValue = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const bareValue = (value: string) => value.replace(/([+\-!(){}[\]^"~*?:\\/]|\s)/g, "\\$1");

const encodedValue = (value: string, kind: FilterKind) => {
  const trimmed = value.trim();
  if (kind === "number" && Number.isFinite(Number(trimmed))) return trimmed;
  if (kind === "boolean") return trimmed.toLowerCase() === "true" ? "true" : "false";
  return quotedValue(trimmed);
};

export const buildFilterQuery = (rule: FilterRule, field?: SchemaField): string | null => {
  if (!filterRuleComplete(rule)) return null;
  const name = escapeField(rule.field);
  const kind = filterKind(field);
  const value = encodedValue(rule.value, kind);

  switch (rule.operator) {
    case "equals":
      return `${name}:${value}`;
    case "not_equals":
      return `-${name}:${value}`;
    case "contains":
      return `${name}:*${bareValue(rule.value.trim())}*`;
    case "greater_than":
      return `${name}:{${value} TO *]`;
    case "greater_or_equal":
      return `${name}:[${value} TO *]`;
    case "less_than":
      return `${name}:[* TO ${value}}`;
    case "less_or_equal":
      return `${name}:[* TO ${value}]`;
    case "between":
      return `${name}:[${value} TO ${encodedValue(rule.secondValue, kind)}]`;
    case "exists":
      return `${name}:[* TO *]`;
  }
};
