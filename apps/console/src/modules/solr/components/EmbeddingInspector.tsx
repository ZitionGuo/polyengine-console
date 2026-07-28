import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import { Check, Copy, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api, errorMessage } from "../services/api";

interface EmbeddingInspectorProps {
  open: boolean;
  text?: string;
  model?: string;
  onClose: () => void;
}

const displayNumber = (value: number) => value.toFixed(6);

export const EmbeddingInspector = ({
  open,
  text,
  model,
  onClose,
}: EmbeddingInspectorProps) => {
  const [copied, setCopied] = useState(false);
  const preview = useQuery({
    queryKey: ["solr", "embedding-preview", model, text],
    queryFn: ({ signal }) => api.previewEmbedding(text ?? "", signal),
    enabled: open && Boolean(text),
    staleTime: 5 * 60 * 1000,
  });
  const exactVector = useMemo(
    () => preview.data ? JSON.stringify(preview.data.vector) : "",
    [preview.data],
  );
  const displayVector = useMemo(
    () => preview.data
      ? `[${preview.data.vector.map((value) => Number(value.toFixed(8))).join(", ")}]`
      : "",
    [preview.data],
  );

  useEffect(() => setCopied(false), [model, open, text]);

  const copyVector = async () => {
    if (!exactVector || !navigator.clipboard) return;
    await navigator.clipboard.writeText(exactVector);
    setCopied(true);
  };

  return (
    <Drawer
      title="Query embedding"
      open={open}
      onClose={onClose}
      width="min(720px, 100vw)"
      className="embedding-inspector"
      extra={
        <Button
          size="small"
          icon={copied ? <Check size={14} /> : <Copy size={14} />}
          disabled={!preview.data || !navigator.clipboard}
          onClick={() => void copyVector()}
        >
          {copied ? "Copied" : "Copy vector"}
        </Button>
      }
    >
      {preview.isLoading ? <Skeleton active paragraph={{ rows: 8 }} /> : null}
      {preview.isError ? (
        <Alert
          type="error"
          showIcon
          message="Unable to generate the query embedding"
          description={errorMessage(preview.error)}
          action={
            <Button
              size="small"
              icon={<RefreshCw size={14} />}
              onClick={() => void preview.refetch()}
            >
              Retry
            </Button>
          }
        />
      ) : null}
      {preview.data ? (
        <>
          <div className="embedding-query">
            <Typography.Text type="secondary">Query</Typography.Text>
            <Typography.Paragraph>{text}</Typography.Paragraph>
          </div>
          <Descriptions
            size="small"
            column={{ xs: 1, sm: 2 }}
            items={[
              {
                key: "model",
                label: "Model",
                span: 2,
                children: <Typography.Text code>{preview.data.model}</Typography.Text>,
              },
              { key: "dimension", label: "Dimension", children: preview.data.dimension },
              {
                key: "norm",
                label: "L2 norm",
                children: displayNumber(preview.data.statistics.l2_norm),
              },
              {
                key: "range",
                label: "Value range",
                children: `${displayNumber(preview.data.statistics.minimum)} to ${displayNumber(
                  preview.data.statistics.maximum,
                )}`,
              },
              {
                key: "mean",
                label: "Mean",
                children: displayNumber(preview.data.statistics.mean),
              },
              {
                key: "embedding-time",
                label: "Embedding",
                children: `${preview.data.timings.embedding_ms.toFixed(2)} ms`,
              },
              {
                key: "total-time",
                label: "Total",
                children: `${preview.data.timings.total_ms.toFixed(2)} ms`,
              },
            ]}
          />
          <Space size={[6, 6]} wrap className="embedding-state-tags">
            <Tag color={preview.data.cache_hit ? "green" : "blue"}>
              {preview.data.cache_hit ? "Embedding cached" : "Fresh embedding"}
            </Tag>
            {preview.data.cold_start ? <Tag color="gold">Cold start</Tag> : null}
          </Space>
          <div className="embedding-vector-heading">
            <Typography.Title level={4}>Vector values</Typography.Title>
            <Typography.Text type="secondary">
              {preview.data.vector.length.toLocaleString()} values
            </Typography.Text>
          </div>
          <pre className="embedding-vector-values">{displayVector}</pre>
        </>
      ) : null}
    </Drawer>
  );
};
