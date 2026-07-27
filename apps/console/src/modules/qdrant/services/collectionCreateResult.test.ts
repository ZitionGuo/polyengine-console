import { describe, expect, it } from "vitest";

import {
  buildRetryableIndexFailures,
  describeIndexFailure,
  parseRetryIndexSchema,
} from "./collectionCreateResult";

describe("collection create index failures", () => {
  it("keeps schema and upstream error context for retry", () => {
    expect(
      buildRetryableIndexFailures("docs", [
        {
          field_name: "metadata.year",
          field_schema: { type: "integer", lookup: true },
          status_code: 400,
          detail: {
            message: "Qdrant returned an error.",
            upstream_body: { status: { error: "invalid schema" } },
          },
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        key: "docs:metadata.year:0",
        collectionName: "docs",
        fieldName: "metadata.year",
        fieldSchema: { type: "integer", lookup: true },
        statusCode: 400,
        message: 'Qdrant returned an error. {"status":{"error":"invalid schema"}}',
      }),
    ]);
  });

  it("parses editable string and object schemas", () => {
    expect(parseRetryIndexSchema('"keyword"')).toBe("keyword");
    expect(parseRetryIndexSchema('{"type":"text","tokenizer":"word"}')).toEqual({
      type: "text",
      tokenizer: "word",
    });
    expect(() => parseRetryIndexSchema("[]")).toThrow(/string or object/);
  });

  it("describes non-object errors", () => {
    expect(describeIndexFailure("timed out")).toBe("timed out");
  });
});
