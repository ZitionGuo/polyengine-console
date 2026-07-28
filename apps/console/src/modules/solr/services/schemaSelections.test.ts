import { retainAvailableValues } from "./schemaSelections";

describe("schema selection reconciliation", () => {
  it("drops removed fields without resetting valid selections", () => {
    expect(
      retainAvailableValues(
        ["title", "removed", "content"],
        ["title", "content", "summary"],
        ["summary"],
        true,
      ),
    ).toEqual(["title", "content"]);
  });

  it("falls back when every selected lexical field disappeared", () => {
    expect(
      retainAvailableValues(
        ["removed"],
        ["title", "content"],
        ["title"],
        true,
      ),
    ).toEqual(["title"]);
  });

  it("preserves an intentionally empty return-field selection", () => {
    expect(
      retainAvailableValues([], ["id", "title"], ["id", "title"], false),
    ).toEqual([]);
    expect(
      retainAvailableValues(undefined, ["id", "title"], ["id"], false),
    ).toEqual(["id"]);
  });
});
