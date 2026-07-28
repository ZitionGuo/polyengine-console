import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";

import {
  api,
  errorMessage,
  type IngestErrorRow,
  type IngestJob,
} from "../services/api";
import { RetryFailedRowsButton } from "./RetryFailedRowsButton";

interface IngestErrorDrawerProps {
  job?: IngestJob;
  open: boolean;
  retrying?: boolean;
  onRetry: (jobId: string) => void;
  onClose: () => void;
}

const columns: ColumnsType<IngestErrorRow> = [
  {
    title: "Source row",
    dataIndex: "row",
    key: "row",
    width: 104,
    render: (row: number) => row || "Job",
  },
  {
    title: "Document ID",
    dataIndex: "document_id",
    key: "document_id",
    width: 180,
    ellipsis: { showTitle: false },
    render: (value: string) => (
      <Typography.Text code ellipsis={{ tooltip: value || "Not available" }}>
        {value || "—"}
      </Typography.Text>
    ),
  },
  {
    title: "Error",
    dataIndex: "message",
    key: "message",
    render: (value: string) => (
      <Typography.Text className="ingest-error-message">{value}</Typography.Text>
    ),
  },
];

export const IngestErrorDrawer = ({
  job,
  open,
  retrying = false,
  onRetry,
  onClose,
}: IngestErrorDrawerProps) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const offset = (page - 1) * pageSize;
  const errors = useQuery({
    queryKey: ["solr", "ingest-job-errors", job?.id, offset, pageSize],
    queryFn: ({ signal }) => api.jobErrors(job?.id ?? "", offset, pageSize, signal),
    enabled: open && Boolean(job),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    setPage(1);
    setPageSize(25);
  }, [job?.id, open]);

  return (
    <Drawer
      title="Ingest errors"
      open={open && Boolean(job)}
      onClose={onClose}
      width="min(820px, 100vw)"
      className="ingest-error-drawer"
      extra={
        job ? (
          <Space size="small">
            <RetryFailedRowsButton
              job={job}
              loading={retrying}
              onRetry={onRetry}
            />
            <Button
              size="small"
              icon={<Download size={14} />}
              href={api.jobErrorsUrl(job.id)}
            >
              CSV
            </Button>
          </Space>
        ) : null
      }
    >
      {job ? (
        <>
          <Descriptions
            className="ingest-error-summary"
            size="small"
            column={{ xs: 1, sm: 2 }}
            items={[
              { key: "file", label: "File", children: job.filename },
              { key: "collection", label: "Collection", children: job.collection },
              {
                key: "status",
                label: "Status",
                children: <Tag color={job.status === "failed" ? "red" : "gold"}>{job.status}</Tag>,
              },
              {
                key: "failed",
                label: "Failed rows",
                children: job.failed.toLocaleString(),
              },
              {
                key: "targets",
                label: "Vector mappings",
                span: 2,
                children: (
                  <Space size={[4, 4]} wrap>
                    {job.vector_targets.map((target) => (
                      <Tag key={target.vector_field}>
                        {target.vector_field} ← {target.text_fields.join(" + ")}
                      </Tag>
                    ))}
                  </Space>
                ),
              },
            ]}
          />
          {errors.isError ? (
            <Alert
              type="error"
              showIcon
              message="Unable to load ingest errors"
              description={errorMessage(errors.error)}
              action={<Button size="small" onClick={() => void errors.refetch()}>Retry</Button>}
            />
          ) : null}
          <Table<IngestErrorRow>
            rowKey={(record) => `${record.row}:${record.document_id}:${record.message}`}
            columns={columns}
            dataSource={errors.data?.items ?? []}
            loading={errors.isLoading || errors.isFetching}
            size="small"
            tableLayout="fixed"
            scroll={{ x: 640 }}
            pagination={{
              current: page,
              pageSize,
              total: errors.data?.total ?? 0,
              showSizeChanger: (errors.data?.total ?? 0) > 25,
              pageSizeOptions: [25, 50, 100],
              showTotal: (total) => `${total.toLocaleString()} errors`,
              onChange: (nextPage, nextPageSize) => {
                setPage(nextPageSize === pageSize ? nextPage : 1);
                setPageSize(nextPageSize);
              },
            }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="No error rows recorded"
                />
              ),
            }}
          />
        </>
      ) : null}
    </Drawer>
  );
};
