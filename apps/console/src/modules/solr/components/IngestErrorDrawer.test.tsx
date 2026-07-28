import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

const jobErrors = vi.hoisted(() => vi.fn());

vi.mock("../services/api", async () => {
  const actual = await vi.importActual<typeof import("../services/api")>("../services/api");
  return {
    ...actual,
    api: { ...actual.api, jobErrors },
  };
});

import type { IngestJob } from "../services/api";
import { IngestErrorDrawer } from "./IngestErrorDrawer";

const job: IngestJob = {
  id: "job-1",
  collection: "docs",
  filename: "documents.jsonl",
  vector_targets: [{ vector_field: "embedding", text_fields: ["title", "content"] }],
  retry_of: null,
  retryable_rows: 1,
  status: "completed",
  total: 3,
  processed: 3,
  succeeded: 2,
  failed: 1,
  created_at: "2026-07-28T00:00:00Z",
};

describe("IngestErrorDrawer", () => {
  it("loads and displays the first page of source errors", async () => {
    jobErrors.mockResolvedValue({
      items: [{
        row: 2,
        document_id: "doc-2",
        message: "Temporary Solr update failure.",
      }],
      total: 1,
      offset: 0,
      limit: 25,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <IngestErrorDrawer
          job={job}
          open
          onRetry={vi.fn()}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Temporary Solr update failure.")).toBeInTheDocument();
    expect(screen.getByText("doc-2")).toBeInTheDocument();
    expect(screen.getByText("embedding ← title + content")).toBeInTheDocument();
    expect(jobErrors).toHaveBeenCalledWith("job-1", 0, 25, expect.any(AbortSignal));
    client.clear();
  });
});
