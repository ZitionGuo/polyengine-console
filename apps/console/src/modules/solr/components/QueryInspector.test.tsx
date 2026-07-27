import { render, screen } from "@testing-library/react";

import type { SearchPayload } from "../services/api";
import { QueryInspector } from "./QueryInspector";

const payload: SearchPayload = {
  collection: "docs",
  mode: "semantic",
  hybrid_strategy: "rerank",
  text: "backup recovery",
  vector_field: "embedding",
        lexical_fields: [],
        lexical_boosts: {},
  limit: 10,
  vector_candidates: 100,
  lexical_candidates: 100,
  rerank_docs: 100,
  rerank_weight: 2,
  lexical_weight: 1,
  vector_weight: 1,
  hybrid_rrf_k: 60,
  timeout_ms: 2_500,
  min_score: null,
  filters: ['category:"backup"'],
  return_fields: ["id", "title"],
};

describe("QueryInspector", () => {
  it("shows readable request details and keeps the raw body collapsed", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <QueryInspector
        open
        payload={payload}
        vectorFields={["embedding", "embedding_title"]}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText("POST /api/search/compare")).toBeVisible();
    expect(screen.getByText("backup recovery")).toBeVisible();
    expect(screen.getByText("2500 ms")).toBeVisible();
    expect(screen.getAllByText("embedding")).not.toHaveLength(0);
    expect(screen.getByText("{!knn f=embedding topK=10}<384-dimensional-query-vector>")).toBeVisible();
    expect(screen.queryByText(/"vector_fields"/)).not.toBeInTheDocument();
    expect(screen.getByText("Raw API request body")).toBeVisible();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
