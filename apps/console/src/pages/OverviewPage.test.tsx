import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api as qdrantApi } from "../modules/qdrant/services/api";
import { api as solrApi } from "../modules/solr/services/api";
import { OverviewPage } from "./OverviewPage";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OverviewPage", () => {
  it("keeps a healthy engine usable when another engine is offline", async () => {
    vi.spyOn(qdrantApi, "health").mockRejectedValue(new Error("Failed to fetch"));
    vi.spyOn(solrApi, "health").mockResolvedValue({
      status: "ok",
      solr: {
        version: "9.10.0",
        mode: "solrcloud",
        endpoint: "http://localhost:8983/solr",
        admin_url: "http://localhost:8983/solr",
      },
      model: {
        name: "sentence-transformers/all-MiniLM-L6-v2",
        dimension: 384,
        status: "ready",
      },
    });
    vi.spyOn(solrApi, "collections").mockResolvedValue({
      collections: [],
      model_dimension: 384,
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <OverviewPage onNavigate={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Qdrant is unreachable")).toBeVisible();
    expect(await screen.findByText("9.10.0")).toBeVisible();
    expect(screen.getByRole("button", { name: "Search" })).toBeEnabled();
  });

  it("shows the configured public endpoint for each engine", async () => {
    vi.spyOn(qdrantApi, "health").mockResolvedValue({
      status: "ok",
      endpoint: "https://qdrant.example:7443/vector",
      qdrant: { version: "1.17.0" },
    });
    vi.spyOn(qdrantApi, "listCollections").mockResolvedValue({
      result: { collections: [] },
    });
    vi.spyOn(qdrantApi, "getCluster").mockResolvedValue({
      result: { status: "disabled" },
    });
    vi.spyOn(solrApi, "health").mockResolvedValue({
      status: "ok",
      solr: {
        version: "9.10.0",
        mode: "solrcloud",
        endpoint: "https://search.example:9443/solr",
        admin_url: "https://search.example:9443/solr/#/",
      },
      model: {
        name: "sentence-transformers/all-MiniLM-L6-v2",
        dimension: 384,
        status: "ready",
      },
    });
    vi.spyOn(solrApi, "collections").mockResolvedValue({
      collections: [],
      model_dimension: 384,
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <OverviewPage onNavigate={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("qdrant.example:7443/vector")).toBeVisible();
    expect(await screen.findByText("search.example:9443/solr")).toBeVisible();
  });
});
