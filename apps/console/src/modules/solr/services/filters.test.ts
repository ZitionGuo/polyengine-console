import type { SchemaField } from "./api";
import {
  buildFilterQuery,
  filterKind,
  filterRuleComplete,
  operatorsForField,
  type FilterRule,
} from "./filters";

const field = (name: string, type: string, className: string): SchemaField => ({
  name,
  type,
  class: className,
  indexed: true,
});

const rule = (overrides: Partial<FilterRule> = {}): FilterRule => ({
  id: "rule-1",
  field: "category",
  operator: "equals",
  value: "engineering",
  secondValue: "",
  ...overrides,
});

describe("typed Solr filters", () => {
  it("detects schema field kinds and restricts boolean operators", () => {
    const boolField = field("in_stock", "boolean", "solr.BoolField");
    expect(filterKind(boolField)).toBe("boolean");
    expect(operatorsForField(boolField).map((item) => item.value)).toEqual([
      "equals",
      "not_equals",
      "exists",
    ]);
  });

  it("quotes text values and escapes embedded quotes", () => {
    expect(buildFilterQuery(rule({ value: 'release "guide"' }), field("category", "string", "solr.StrField")))
      .toBe('category:"release \\"guide\\""');
  });

  it("builds numeric and range filters", () => {
    const numberField = field("priority", "pint", "solr.IntPointField");
    expect(buildFilterQuery(rule({ field: "priority", operator: "greater_or_equal", value: "3" }), numberField))
      .toBe("priority:[3 TO *]");
    expect(
      buildFilterQuery(
        rule({ field: "priority", operator: "between", value: "3", secondValue: "8" }),
        numberField,
      ),
    ).toBe("priority:[3 TO 8]");
  });

  it("builds contains, boolean, and existence filters", () => {
    expect(buildFilterQuery(rule({ operator: "contains", value: "schema design" })))
      .toBe("category:*schema\\ design*");
    expect(
      buildFilterQuery(
        rule({ field: "in_stock", value: "TRUE" }),
        field("in_stock", "boolean", "solr.BoolField"),
      ),
    ).toBe("in_stock:true");
    expect(buildFilterQuery(rule({ operator: "exists", value: "" }))).toBe("category:[* TO *]");
  });

  it("rejects incomplete values and ranges", () => {
    expect(filterRuleComplete(rule({ value: "" }))).toBe(false);
    expect(filterRuleComplete(rule({ operator: "between", secondValue: "" }))).toBe(false);
    expect(buildFilterQuery(rule({ operator: "between", secondValue: "" }))).toBeNull();
  });
});
