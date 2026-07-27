import { Button, Collapse, Descriptions, Drawer, Space, Tag, Typography } from "antd";
import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";

import type { SearchPayload } from "../services/api";
import { buildQueryRequestPreview } from "../services/queryPreview";

interface QueryInspectorProps {
  open: boolean;
  payload?: SearchPayload;
  vectorFields: string[];
  targetMode?: "single" | "compare" | "fuse";
  fusion?: {
    vectorWeights: Record<string, number>;
    vectorMinScores?: Record<string, number | null>;
    fusionCandidates: number;
    rrfK: number;
  };
  onClose: () => void;
}

const displayParam = (value: string | number | string[]) =>
  Array.isArray(value) ? value.join("\n") : String(value);

export const QueryInspector = ({
  open,
  payload,
  vectorFields,
  targetMode,
  fusion,
  onClose,
}: QueryInspectorProps) => {
  const [copied, setCopied] = useState(false);
  const preview = useMemo(
    () => (payload ? buildQueryRequestPreview(payload, vectorFields, targetMode, fusion) : undefined),
    [fusion, payload, targetMode, vectorFields],
  );

  const copyApiRequest = async () => {
    if (!preview) return;
    const request = `POST ${preview.endpoint}\nContent-Type: application/json\n\n${JSON.stringify(preview.api_body, null, 2)}`;
    await navigator.clipboard.writeText(request);
    setCopied(true);
  };

  return (
    <Drawer
      title="Query Inspector"
      open={open}
      onClose={() => {
        setCopied(false);
        onClose();
      }}
      width="min(680px, 100vw)"
      className="query-inspector"
      extra={
        <Button
          size="small"
          icon={copied ? <Check size={14} /> : <Copy size={14} />}
          disabled={!preview || !navigator.clipboard}
          onClick={() => void copyApiRequest()}
        >
          {copied ? "Copied" : "Copy API request"}
        </Button>
      }
    >
      {payload && preview ? (
        <>
          <Descriptions
            className="query-summary"
            size="small"
            column={1}
            items={[
              { key: "endpoint", label: "Endpoint", children: <Typography.Text key="endpoint-value" code>POST {preview.endpoint}</Typography.Text> },
              { key: "collection", label: "Collection", children: payload.collection },
              { key: "mode", label: "Mode", children: <Tag key="mode-value" color={payload.mode === "hybrid" ? "geekblue" : "blue"}>{payload.mode}</Tag> },
              ...(payload.mode === "hybrid" ? [{
                key: "hybrid-strategy",
                label: "Hybrid strategy",
                children: payload.hybrid_strategy === "rrf" ? "Parallel RRF fusion" : "Vector rerank",
              }] : []),
              { key: "topk", label: "Results (topK)", children: payload.limit },
              {
                key: "timeout",
                label: "Query timeout",
                children: `${payload.timeout_ms ?? 15_000} ms`,
              },
              ...(payload.min_score != null ? [
                { key: "min-score", label: "Minimum similarity", children: payload.min_score },
              ] : []),
              ...(targetMode === "fuse" ? [
                { key: "fusion", label: "Fusion", children: "Weighted reciprocal rank fusion" },
                { key: "candidates", label: "Candidates / field", children: fusion?.fusionCandidates ?? 50 },
                { key: "rrf-k", label: "RRF constant", children: fusion?.rrfK ?? 60 },
              ] : []),
              ...(payload.mode === "hybrid" && payload.hybrid_strategy === "rrf" ? [
                { key: "bm25-candidates", label: "BM25 candidates", children: payload.lexical_candidates },
                ...(targetMode !== "fuse" ? [
                  { key: "vector-candidates", label: "Vector candidates", children: payload.vector_candidates },
                  { key: "hybrid-rrf-k", label: "RRF constant", children: payload.hybrid_rrf_k },
                ] : []),
              ] : []),
              { key: "query", label: "Query", children: payload.text },
              ...(payload.mode === "hybrid" ? [
                {
                  key: "lexical-fields",
                  label: "BM25 fields",
                  children: (
                    <Space key="lexical-field-values" size={[4, 4]} wrap>
                      {payload.lexical_fields.map((field) => (
                        <Tag key={field}>{field} · {payload.lexical_boosts[field] ?? 1}x</Tag>
                      ))}
                    </Space>
                  ),
                },
              ] : []),
              {
                key: "vectors",
                label: payload.mode === "hybrid" && payload.hybrid_strategy === "rrf"
                  ? "Retrieval sources"
                  : "Vector fields",
                children: (
                  <Space key="vector-values" size={[4, 4]} wrap>
                    {preview.solr_requests.map((request) => (
                      <Tag key={request.vector_field}>
                        {request.vector_field}
                        {payload.mode === "hybrid" && payload.hybrid_strategy === "rrf"
                          ? ` · ${
                            request.vector_field === "BM25"
                              ? payload.lexical_weight
                              : targetMode === "fuse"
                                ? fusion?.vectorWeights[request.vector_field] ?? 1
                                : payload.vector_weight
                          }x`
                          : targetMode === "fuse"
                            ? ` · ${fusion?.vectorWeights[request.vector_field] ?? 1}x`
                            : ""}
                        {fusion?.vectorMinScores?.[request.vector_field] !== null
                          && fusion?.vectorMinScores?.[request.vector_field] !== undefined
                          ? ` · ≥${fusion.vectorMinScores[request.vector_field]}`
                          : ""}
                      </Tag>
                    ))}
                  </Space>
                ),
              },
              {
                key: "filters",
                label: "Filters",
                children: payload.filters.length ? (
                  <Space key="filter-values" direction="vertical" size={2}>
                    {payload.filters.map((filter) => <Typography.Text code key={filter}>{filter}</Typography.Text>)}
                  </Space>
                ) : <Typography.Text key="no-filters" type="secondary">None</Typography.Text>,
              },
              {
                key: "fields",
                label: "Return fields",
                children: payload.return_fields.length ? payload.return_fields.join(", ") : "All stored fields",
              },
            ]}
          />
          <div className="query-solr-requests">
            <Typography.Title level={4}>Solr execution</Typography.Title>
            {preview.solr_requests.map((request) => (
              <section key={request.vector_field} className="query-solr-request">
                <div className="query-solr-request-heading">
                  <Typography.Text strong>{request.vector_field}</Typography.Text>
                  <Typography.Text code>{request.method} {request.path}</Typography.Text>
                </div>
                <dl>
                  {Object.entries(request.params).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd><pre>{displayParam(value)}</pre></dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
          <Collapse
            ghost
            className="query-api-body"
            items={[
              {
                key: "api-body",
                label: "Raw API request body",
                children: <pre className="json-block">{JSON.stringify(preview.api_body, null, 2)}</pre>,
              },
            ]}
          />
        </>
      ) : null}
    </Drawer>
  );
};
