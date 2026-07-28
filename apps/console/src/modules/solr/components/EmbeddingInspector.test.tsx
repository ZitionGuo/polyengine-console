import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

const previewEmbedding = vi.hoisted(() => vi.fn());

vi.mock("../services/api", async () => {
  const actual = await vi.importActual<typeof import("../services/api")>("../services/api");
  return {
    ...actual,
    api: { ...actual.api, previewEmbedding },
  };
});

import { EmbeddingInspector } from "./EmbeddingInspector";

describe("EmbeddingInspector", () => {
  it("loads statistics on demand and copies the exact vector", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    previewEmbedding.mockResolvedValue({
      model: "sentence-transformers/all-MiniLM-L6-v2",
      dimension: 3,
      vector: [0.123456789, -0.5, 0.25],
      statistics: {
        l2_norm: 0.573232,
        minimum: -0.5,
        maximum: 0.25,
        mean: -0.042181,
      },
      timings: {
        model_load_ms: 0,
        embedding_ms: 2.75,
        total_ms: 2.9,
      },
      cold_start: false,
      cache_hit: true,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <EmbeddingInspector
          open
          text="schema migration"
          model="sentence-transformers/all-MiniLM-L6-v2"
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("sentence-transformers/all-MiniLM-L6-v2")).toBeInTheDocument();
    expect(screen.getByText("Embedding cached")).toBeInTheDocument();
    expect(screen.getByText("3 values")).toBeInTheDocument();
    expect(previewEmbedding).toHaveBeenCalledWith("schema migration", expect.any(AbortSignal));

    fireEvent.click(screen.getByRole("button", { name: "Copy vector" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("[0.123456789,-0.5,0.25]"),
    );
    client.clear();
  });
});
