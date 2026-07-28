import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api as qdrantApi } from "../modules/qdrant/services/api";
import { api as solrApi } from "../modules/solr/services/api";
import { api as elasticsearchApi } from "../modules/elasticsearch/services/api";
import { OverviewPage } from "./OverviewPage";

afterEach(() => {
  vi.restoreAllMocks();
});

const mockElasticsearchOffline = () =>
  vi.spyOn(elasticsearchApi, "health").mockRejectedValue(new Error("ES offline"));

describe("OverviewPage", () => {
  it("keeps a healthy engine usable when another engine is offline", async () => {
    mockElasticsearchOffline();
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
    expect(screen.getAllByRole("button", { name: "Search" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Search" })[0]).toBeEnabled();
  });

  it("shows the configured public endpoint for each engine", async () => {
    vi.spyOn(elasticsearchApi, "health").mockResolvedValue({
      status: "ok",
      elasticsearch: {
        version: "9.4.4",
        endpoint: "https://elastic.example:9200",
      },
      capabilities: {
        type: "basic",
        native_rrf: false,
        inference: false,
      },
      model: {
        name: "Qwen/Qwen3-Embedding-0.6B",
        dimension: 384,
        status: "ready",
      },
    });
    vi.spyOn(elasticsearchApi, "indices").mockResolvedValue({
      indices: [],
      model_dimension: 384,
    });
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
    expect(await screen.findByText("elastic.example:9200")).toBeVisible();
  });
});
