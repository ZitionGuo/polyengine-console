import { fireEvent, render, screen } from "@testing-library/react";

import type { IngestJob } from "../services/api";
import { RetryFailedRowsButton } from "./RetryFailedRowsButton";

const job: IngestJob = {
  id: "job-1",
  collection: "docs",
  filename: "documents.jsonl",
  vector_targets: [{ vector_field: "embedding", text_fields: ["title"] }],
  retry_of: null,
  retryable_rows: 1,
  status: "completed",
  total: 3,
  processed: 3,
  succeeded: 2,
  failed: 1,
  created_at: "2026-07-28T00:00:00Z",
};

describe("RetryFailedRowsButton", () => {
  it("confirms before retrying the source job", async () => {
    const onRetry = vi.fn();
    render(<RetryFailedRowsButton job={job} onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry failed rows from documents.jsonl" }));
    expect(await screen.findByText("Retry 1 failed row?")).toBeInTheDocument();
    expect(onRetry).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onRetry).toHaveBeenCalledWith("job-1");
  });

  it("stays hidden while the source job is active", () => {
    const { container } = render(
      <RetryFailedRowsButton
        job={{ ...job, status: "running" }}
        onRetry={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
