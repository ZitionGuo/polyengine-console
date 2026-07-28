import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

const clearEmbeddingCache = vi.hoisted(() => vi.fn());

vi.mock("../services/api", async () => {
  const actual = await vi.importActual<typeof import("../services/api")>("../services/api");
  return {
    ...actual,
    api: { ...actual.api, clearEmbeddingCache },
  };
});

import { EmbeddingCacheClearButton } from "./EmbeddingCacheClearButton";

describe("EmbeddingCacheClearButton", () => {
  it("confirms, clears backend state, and invalidates embedding previews", async () => {
    clearEmbeddingCache.mockResolvedValue({
      cleared: 2,
      model: {
        name: "model",
        dimension: 384,
        status: "ready",
        query_cache: { entries: 0, capacity: 512, ttl_seconds: 900 },
      },
    });
    const onCleared = vi.fn();
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });
    client.setQueryData(["solr", "embedding-preview", "model", "query"], { vector: [1] });

    render(
      <QueryClientProvider client={client}>
        <EmbeddingCacheClearButton
          entries={2}
          showLabel
          onCleared={onCleared}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear query embedding cache" }));
    expect(await screen.findByText("Clear 2 cached embeddings?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    await waitFor(() => expect(clearEmbeddingCache).toHaveBeenCalledOnce());
    expect(
      client.getQueryState(["solr", "embedding-preview", "model", "query"])?.isInvalidated,
    ).toBe(true);
    expect(onCleared).toHaveBeenCalledOnce();
    client.clear();
  });
});
