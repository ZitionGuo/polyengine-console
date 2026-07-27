export interface SolrValueSummary {
  text: string;
  tooltip: string;
}

const scalarText = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
};

export const summarizeSolrValue = (value: unknown): SolrValueSummary => {
  if (!Array.isArray(value)) {
    if (typeof value === "object" && value !== null) {
      const fieldCount = Object.keys(value).length;
      const text = `${fieldCount} structured field${fieldCount === 1 ? "" : "s"}`;
      return { text, tooltip: text };
    }
    const text = scalarText(value);
    return { text, tooltip: text };
  }

  if (!value.length) return { text: "No values", tooltip: "No values" };

  const primitiveValues = value.every((item) => item === null || typeof item !== "object");
  if (!primitiveValues) {
    const text = `${value.length} structured item${value.length === 1 ? "" : "s"}`;
    return { text, tooltip: text };
  }

  if (value.length === 1) {
    const text = scalarText(value[0]);
    return { text, tooltip: text };
  }

  if (value.length > 12 && value.every((item) => typeof item === "number")) {
    const text = `${value.length} numeric values`;
    return { text, tooltip: text };
  }

  const text = value.map(scalarText).join(" · ");
  return { text, tooltip: text };
};
