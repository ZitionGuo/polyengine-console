import { Button, Popconfirm, Tooltip } from "antd";
import { RotateCcw } from "lucide-react";

import type { IngestJob } from "../services/api";

interface RetryFailedRowsButtonProps {
  job: IngestJob;
  loading?: boolean;
  onRetry: (jobId: string) => void;
}

export const RetryFailedRowsButton = ({
  job,
  loading = false,
  onRetry,
}: RetryFailedRowsButtonProps) => {
  if (
    job.retryable_rows < 1
    || job.status === "queued"
    || job.status === "running"
  ) return null;

  const rowLabel = job.retryable_rows === 1 ? "row" : "rows";
  return (
    <Popconfirm
      title={`Retry ${job.retryable_rows.toLocaleString()} failed ${rowLabel}?`}
      description="A new job will reuse the original upload and field mappings."
      onConfirm={() => onRetry(job.id)}
    >
      <Tooltip title="Retry failed rows">
        <Button
          type="text"
          icon={<RotateCcw size={15} />}
          loading={loading}
          aria-label={`Retry failed rows from ${job.filename}`}
        />
      </Tooltip>
    </Popconfirm>
  );
};
