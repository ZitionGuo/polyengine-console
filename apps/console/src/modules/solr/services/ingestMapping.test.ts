import {
  addMissingVectorTargets,
  reconcileVectorTargets,
  suggestTextFields,
} from "./ingestMapping";

describe("ingest vector target mapping", () => {
  it("prefers a field hinted by the vector field name", () => {
    expect(
      suggestTextFields(
        "embedding_title",
        ["id", "title", "content"],
        "id",
      ),
    ).toEqual(["title"]);
  });

  it("uses useful general text fields for a generic embedding", () => {
    expect(
      suggestTextFields(
        "embedding",
        ["id", "category", "content", "title"],
        "id",
      ),
    ).toEqual(["title", "content"]);
  });

  it("retains valid mappings and removes stale or duplicate targets", () => {
    expect(
      reconcileVectorTargets(
        ["embedding", "embedding_title"],
        ["id", "title", "content"],
        "id",
        [
          { vector_field: "embedding", text_fields: ["content", "missing"] },
          { vector_field: "embedding", text_fields: ["title"] },
          { vector_field: "retired_vector", text_fields: ["content"] },
        ],
      ),
    ).toEqual([
      { vector_field: "embedding", text_fields: ["content"] },
    ]);
  });

  it("can add every compatible vector field with independent source suggestions", () => {
    expect(
      addMissingVectorTargets(
        ["embedding", "embedding_title"],
        ["id", "title", "content"],
        "id",
        [{ vector_field: "embedding", text_fields: ["title", "content"] }],
      ),
    ).toEqual([
      { vector_field: "embedding", text_fields: ["title", "content"] },
      { vector_field: "embedding_title", text_fields: ["title"] },
    ]);
  });
});
