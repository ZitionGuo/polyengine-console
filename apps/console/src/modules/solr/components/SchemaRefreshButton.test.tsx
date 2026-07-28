import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

const refreshSchema = vi.hoisted(() => vi.fn());

vi.mock("../services/api", async () => {
  const actual = await vi.importActual<typeof import("../services/api")>("../services/api");
  return {
    ...actual,
    api: { ...actual.api, refreshSchema },
  };
});

import { SchemaRefreshButton } from "./SchemaRefreshButton";

describe("SchemaRefreshButton", () => {
  it("replaces the cached schema with a fresh Solr response", async () => {
    const schema = {
      collection: "docs",
      fields: [{ name: "embedding_v2" }],
      vector_fields: [{ name: "embedding_v2", compatible: true }],
      text_fields: [],
    };
    refreshSchema.mockResolvedValue(schema);
    const onRefreshed = vi.fn();
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <SchemaRefreshButton collection="docs" onRefreshed={onRefreshed} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh docs schema" }));

    await waitFor(() => expect(refreshSchema).toHaveBeenCalledWith("docs"));
    expect(client.getQueryData(["solr", "schema", "docs"])).toEqual(schema);
    expect(onRefreshed).toHaveBeenCalledOnce();
    client.clear();
  });
});
