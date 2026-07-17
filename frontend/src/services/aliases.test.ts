import { describe, expect, it } from "vitest";

import { buildAliasUpdatePayload } from "./aliases";

const current = {
  alias_name: "docs_live",
  collection_name: "docs_v1",
};

describe("alias update payload", () => {
  it("sends only changed fields", () => {
    expect(
      buildAliasUpdatePayload(current, {
        aliasName: " docs_current ",
        collectionName: "docs_v1",
      }),
    ).toEqual({ new_alias_name: "docs_current" });

    expect(
      buildAliasUpdatePayload(current, {
        aliasName: "docs_live",
        collectionName: "docs_v2",
      }),
    ).toEqual({ collection_name: "docs_v2" });
  });

  it("supports renaming and reassigning in one update", () => {
    expect(
      buildAliasUpdatePayload(current, {
        aliasName: "docs_current",
        collectionName: "docs_v2",
      }),
    ).toEqual({
      new_alias_name: "docs_current",
      collection_name: "docs_v2",
    });
  });

  it("rejects empty and unchanged edits", () => {
    expect(() =>
      buildAliasUpdatePayload(current, {
        aliasName: " ",
        collectionName: "docs_v1",
      }),
    ).toThrow(/required/);
    expect(() =>
      buildAliasUpdatePayload(current, {
        aliasName: "docs_live",
        collectionName: "docs_v1",
      }),
    ).toThrow(/No alias changes/);
  });
});
