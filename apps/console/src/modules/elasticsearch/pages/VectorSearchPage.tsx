import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Collapse,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Segmented,
  Select,
  Skeleton,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  Binary,
  BrainCircuit,
  Braces,
  CircleStop,
  Eye,
  GitCompareArrows,
  Layers3,
  Plus,
  Search,
  TimerReset,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  api,
  errorMessage,
  type ElasticsearchHit,
  type IndexSchema,
  type ResultMode,
  type SearchResult,
  type VectorField,
  type VectorProvider,
} from "../services/api";
import {
  buildSearchPayload,
  type SearchFormValues,
  type VectorTargetFormValue,
} from "../services/searchPayload";

const providerLabel: Record<VectorProvider, string> = {
  local: "Local Qwen",
  field_native: "Field-native",
  inference: "ES inference",
};

const formatDuration = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(1)} ms`;

const resultTitle = (hit: ElasticsearchHit) => {
  const source = hit._source ?? {};
  for (const key of ["title", "name", "subject", "id"]) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return hit._id ?? "Untitled document";
};

const resultSummary = (hit: ElasticsearchHit) => {
  const highlighted = hit.highlight ? Object.values(hit.highlight).flat()[0] : undefined;
  if (highlighted) return highlighted.replace(/<[^>]+>/g, "");
  const source = hit._source ?? {};
  for (const key of ["content", "body", "description", "text", "summary"]) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return JSON.stringify(source);
};

const defaultTarget = (field?: VectorField) => ({
  field: field?.name,
  provider: (field?.type === "semantic_text"
    ? "field_native"
    : field?.local_compatible
      ? "local"
      : "inference") as VectorProvider,
  inference_id: field?.type === "semantic_text"
    ? undefined
    : (field?.inference_id ?? undefined),
  weight: 1,
  min_similarity: null,
  num_candidates: null,
});

const ResultList = ({
  hits,
  onInspect,
}: {
  hits: ElasticsearchHit[];
  onInspect: (hit: ElasticsearchHit) => void;
}) => (
  <List
    className="es-results-list"
    dataSource={hits}
    locale={{ emptyText: <Empty description="No matching documents" /> }}
    renderItem={(hit, position) => (
      <List.Item
        actions={[
          <Button
            key="inspect"
            type="text"
            icon={<Eye size={15} />}
            aria-label={`Inspect result ${position + 1}`}
            onClick={() => onInspect(hit)}
          />,
        ]}
      >
        <div className="es-result-rank">{position + 1}</div>
        <List.Item.Meta
          title={
            <Space size={8}>
              <Typography.Text strong ellipsis={{ tooltip: resultTitle(hit) }}>
                {resultTitle(hit)}
              </Typography.Text>
              <Tag>{hit._score?.toFixed(5) ?? "no score"}</Tag>
            </Space>
          }
          description={
            <Typography.Paragraph ellipsis={{ rows: 2, tooltip: resultSummary(hit) }}>
              {resultSummary(hit)}
            </Typography.Paragraph>
          }
        />
      </List.Item>
    )}
  />
);

export const VectorSearchPage = () => {
  const [form] = Form.useForm<SearchFormValues>();
  const cache = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [selectedHit, setSelectedHit] = useState<ElasticsearchHit | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<string>();
  const [targets, setTargets] = useState<VectorTargetFormValue[]>([]);
  const [resultMode, setResultMode] = useState<ResultMode>("single");
  const searchMode = Form.useWatch("mode", form) ?? "vector";

  const indices = useQuery({
    queryKey: ["elasticsearch", "indices"],
    queryFn: api.indices,
  });
  const schema = useQuery({
    queryKey: ["elasticsearch", "schema", selectedIndex],
    queryFn: () => api.schema(selectedIndex!),
    enabled: Boolean(selectedIndex),
  });
  const inference = useQuery({
    queryKey: ["elasticsearch", "inference"],
    queryFn: api.inferenceEndpoints,
    retry: false,
  });
  const health = useQuery({
    queryKey: ["elasticsearch", "health"],
    queryFn: api.health,
  });
  const loadModel = useMutation({
    mutationFn: api.loadModel,
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["elasticsearch", "health"] });
      message.success("Qwen embedding model is ready.");
    },
    onError: (error) => message.error(errorMessage(error)),
  });
  const preview = useMutation({
    mutationFn: ({ text, signal }: { text: string; signal?: AbortSignal }) =>
      api.previewEmbedding(text, signal),
    onSuccess: () => setPreviewOpen(true),
    onError: (error) => message.error(errorMessage(error)),
  });
  const runSearch = useMutation({
    mutationFn: ({ values, signal }: { values: SearchFormValues; signal: AbortSignal }) =>
      api.search(buildSearchPayload(values), signal),
    onSuccess: (data) => setResult(data),
    onError: (error) => {
      if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
        message.info("Search cancelled.");
        return;
      }
      message.error(errorMessage(error));
    },
    onSettled: () => {
      abortRef.current = null;
    },
  });

  const availableIndices = useMemo(
    () => indices.data?.indices.filter((index) => index.vector_fields.length > 0) ?? [],
    [indices.data],
  );
  const vectorFields = schema.data?.vector_fields.filter((field) => field.compatible) ?? [];
  const selectedFields = targets.map((target) => target?.field).filter(Boolean);
  const targetForField = (field?: VectorField) => {
    const target = defaultTarget(field);
    if (
      target.provider === "inference"
      && !target.inference_id
      && inference.data?.endpoints.length === 1
    ) {
      target.inference_id = inference.data.endpoints[0].id;
    }
    return target;
  };

  useEffect(() => {
    if (!selectedIndex && availableIndices.length) {
      const first = availableIndices.find((index) => index.ready) ?? availableIndices[0];
      setSelectedIndex(first.name);
      form.setFieldValue("index", first.name);
    }
  }, [availableIndices, form, selectedIndex]);

  useEffect(() => {
    if (!schema.data?.vector_fields.length) return;
    const valid = targets.filter((target) =>
      schema.data?.vector_fields.some((field) => field.name === target.field && field.compatible),
    );
    if (valid.length) {
      if (valid.length !== targets.length) setTargets(valid);
      return;
    }
    const first = schema.data.vector_fields.find((field) => field.compatible);
    setTargets(first ? [targetForField(first)] : []);
    setResultMode("single");
    form.setFieldValue(
      "source_fields",
      schema.data.text_fields.slice(0, 4).map((field) => field.name),
    );
    form.setFieldValue(
      "lexical_fields",
      schema.data.text_fields.slice(0, 2).map((field) => field.name),
    );
  }, [form, inference.data, schema.data]);

  useEffect(() => {
    if (targets.length === 1 && resultMode !== "single") {
      setResultMode("single");
    } else if (targets.length > 1 && resultMode === "single") {
      setResultMode("compare");
    }
  }, [resultMode, targets.length]);

  const onIndexChange = (index: string) => {
    setSelectedIndex(index);
    setResult(null);
    setTargets([]);
    setResultMode("single");
    form.setFieldsValue({
      index,
      source_fields: [],
      lexical_fields: [],
    });
  };

  const onSubmit = (values: SearchFormValues) => {
    const targetCount = targets.length;
    if (!targetCount) {
      message.error("Select at least one vector field.");
      return;
    }
    if (resultMode === "single" && targetCount !== 1) {
      message.error("Single mode uses exactly one vector field.");
      return;
    }
    try {
      buildSearchPayload({ ...values, result_mode: resultMode, vector_targets: targets });
    } catch (error) {
      message.error(errorMessage(error));
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    runSearch.mutate({
      values: { ...values, result_mode: resultMode, vector_targets: targets },
      signal: controller.signal,
    });
  };

  const previewQuery = async () => {
    const text = form.getFieldValue("text")?.trim();
    if (!text) {
      message.warning("Enter a query first.");
      return;
    }
    preview.mutate({ text });
  };

  if (indices.isPending) {
    return <div className="surface es-loading"><Skeleton active paragraph={{ rows: 9 }} /></div>;
  }

  return (
    <div className="es-page es-search-page">
      <div className="es-page-header">
        <div>
          <Typography.Text className="page-eyebrow">ELASTICSEARCH</Typography.Text>
          <Typography.Title level={2}>Vector Search</Typography.Title>
          <Typography.Text type="secondary">
            Convert text to vectors, compare fields, and fuse vector signals with BM25.
          </Typography.Text>
        </div>
        <Space wrap>
          {health.data?.model.status !== "ready" ? (
            <Tooltip title={health.data?.model.name}>
              <Button
                icon={<BrainCircuit size={16} />}
                loading={loadModel.isPending}
                onClick={() => loadModel.mutate()}
              >
                Load local model
              </Button>
            </Tooltip>
          ) : (
            <Tag color="success" icon={<BrainCircuit size={13} />}>Qwen ready</Tag>
          )}
          <Button icon={<Binary size={16} />} loading={preview.isPending} onClick={previewQuery}>
            Inspect embedding
          </Button>
        </Space>
      </div>

      {indices.isError ? (
        <Alert
          type="error"
          showIcon
          message="Elasticsearch is unavailable"
          description={errorMessage(indices.error)}
        />
      ) : !availableIndices.length ? (
        <Alert
          type="warning"
          showIcon
          message="No vector-enabled indices found"
          description="Create a dense_vector or semantic_text field, then refresh the index list."
        />
      ) : (
        <Form<SearchFormValues>
          form={form}
          layout="vertical"
          initialValues={{
            mode: "vector",
            fusion_backend: "application",
            lexical_weight: 1,
            top_k: 10,
            num_candidates: 100,
            rank_constant: 60,
            rank_window_size: 100,
            filters_json: "",
            timeout_ms: 15_000,
          }}
          onFinish={onSubmit}
        >
          <section className="surface es-search-builder">
            <Form.Item
              name="text"
              label="Query"
              rules={[{ required: true, whitespace: true, message: "Enter text to search." }]}
            >
              <Input.TextArea
                rows={3}
                maxLength={5000}
                showCount
                placeholder="What are the tradeoffs of approximate nearest-neighbor search?"
              />
            </Form.Item>

            <div className="es-primary-controls">
              <Form.Item name="index" label="Index" rules={[{ required: true }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  onChange={onIndexChange}
                  options={availableIndices.map((index) => ({
                    label: index.name,
                    value: index.name,
                  }))}
                />
              </Form.Item>
              <Form.Item name="mode" label="Retrieval">
                <Segmented
                  block
                  options={[
                    { label: "Vector", value: "vector" },
                    { label: "Hybrid", value: "hybrid" },
                  ]}
                />
              </Form.Item>
              <Form.Item label="Results">
                <Segmented
                  block
                  value={resultMode}
                  onChange={(next) => setResultMode(next as ResultMode)}
                  options={[
                    { label: "Single", value: "single", disabled: targets.length > 1 },
                    { label: "Compare", value: "compare", disabled: targets.length < 2 },
                    { label: "Fuse", value: "fuse", disabled: targets.length < 2 },
                  ]}
                />
              </Form.Item>
              <Form.Item name="top_k" label="Top K">
                <InputNumber min={1} max={100} className="full-width" />
              </Form.Item>
            </div>

            <div className="es-builder-section-heading">
              <div>
                <Typography.Text strong>Vector targets</Typography.Text>
                <Typography.Text type="secondary">
                  Each field keeps its own embedding provider and ranking controls.
                </Typography.Text>
              </div>
            </div>

            {schema.isFetching ? <Skeleton active paragraph={{ rows: 2 }} /> : null}
            <div className="es-target-list">
              {targets.map((target, index) => {
                const fieldName = target?.field;
                const mapped = vectorFields.find((field) => field.name === fieldName);
                const provider = target?.provider as VectorProvider | undefined;
                const providerOptions = mapped?.type === "semantic_text"
                  ? [{ label: providerLabel.field_native, value: "field_native" }]
                  : [
                      ...(mapped?.local_compatible
                        ? [{ label: providerLabel.local, value: "local" }]
                        : []),
                      { label: providerLabel.inference, value: "inference" },
                    ];
                return (
                  <div className="es-target-row" key={fieldName ?? `target-${index}`}>
                    <div className="es-target-index">{index + 1}</div>
                    <Form.Item
                      label="Vector field"
                      required
                    >
                      <Select
                        value={target.field}
                        showSearch
                        optionFilterProp="label"
                        options={vectorFields.map((field) => ({
                          label: `${field.name} · ${field.type}${field.dimension ? ` · ${field.dimension}d` : ""}`,
                          value: field.name,
                          disabled: selectedFields.includes(field.name) && field.name !== fieldName,
                        }))}
                        onChange={(next) => {
                          const nextField = vectorFields.find((field) => field.name === next);
                          const values = [...targets];
                          values[index] = targetForField(nextField);
                          setTargets(values);
                        }}
                      />
                    </Form.Item>
                    <Form.Item
                      label="Embedding"
                      required
                    >
                      <Select
                        value={target.provider}
                        options={providerOptions}
                        onChange={(next: VectorProvider) => {
                          const values = [...targets];
                          const updated = { ...values[index], provider: next };
                          if (
                            next === "inference"
                            && inference.data?.endpoints.length === 1
                          ) {
                            updated.inference_id = inference.data.endpoints[0].id;
                          } else if (next !== "inference") {
                            updated.inference_id = undefined;
                          }
                          values[index] = updated;
                          setTargets(values);
                        }}
                      />
                    </Form.Item>
                    {provider === "inference" ? (
                      <Form.Item
                        label="Inference endpoint"
                        required
                      >
                        <Select
                          value={target.inference_id}
                          showSearch
                          optionFilterProp="label"
                          placeholder="Select endpoint"
                          options={(inference.data?.endpoints ?? []).map((endpoint) => ({
                            label: `${endpoint.id}${endpoint.service ? ` · ${endpoint.service}` : ""}`,
                            value: endpoint.id,
                          }))}
                          onChange={(next) => {
                            const values = [...targets];
                            values[index] = { ...values[index], inference_id: next };
                            setTargets(values);
                          }}
                          dropdownRender={(menu) => (
                            <>
                              {menu}
                              {!inference.data?.endpoints.length ? (
                                <Typography.Text type="secondary" className="es-select-note">
                                  No text embedding endpoints discovered.
                                </Typography.Text>
                              ) : null}
                            </>
                          )}
                        />
                      </Form.Item>
                    ) : null}
                    <Form.Item
                      label="Weight"
                    >
                      <InputNumber
                        min={0}
                        max={10}
                        step={0.1}
                        className="full-width"
                        value={target.weight}
                        onChange={(next) => {
                          const values = [...targets];
                          values[index] = { ...values[index], weight: next };
                          setTargets(values);
                        }}
                      />
                    </Form.Item>
                    <Tooltip title="Remove vector target">
                      <Button
                        type="text"
                        danger
                        icon={<Trash2 size={16} />}
                        aria-label={`Remove vector target ${index + 1}`}
                        disabled={targets.length === 1}
                        onClick={() => {
                          setTargets(targets.filter((_, position) => position !== index));
                        }}
                      />
                    </Tooltip>
                  </div>
                );
              })}
              <Button
                icon={<Plus size={16} />}
                disabled={targets.length >= vectorFields.length || targets.length >= 8}
                onClick={() => {
                  const next = vectorFields.find((field) => !selectedFields.includes(field.name));
                  if (next) {
                    setTargets([...targets, targetForField(next)]);
                  }
                }}
              >
                Add vector field
              </Button>
            </div>

            <Collapse
              ghost
              className="es-advanced"
              items={[
                {
                  key: "advanced",
                  label: "Advanced retrieval controls",
                  children: (
                    <div className="es-advanced-grid">
                      <Form.Item name="num_candidates" label="Default candidates">
                        <InputNumber min={1} max={10_000} className="full-width" />
                      </Form.Item>
                      <Form.Item name="rank_constant" label="RRF rank constant">
                        <InputNumber min={1} max={1000} className="full-width" />
                      </Form.Item>
                      <Form.Item name="rank_window_size" label="RRF rank window">
                        <InputNumber min={1} max={1000} className="full-width" />
                      </Form.Item>
                      <Form.Item name="timeout_ms" label="Timeout (ms)">
                        <InputNumber min={1000} max={120_000} step={1000} className="full-width" />
                      </Form.Item>
                      {resultMode === "fuse" ? (
                        <Form.Item name="fusion_backend" label="Fusion execution">
                          <Select
                            options={[
                              { label: "Application RRF · Basic license", value: "application" },
                              {
                                label: "Elasticsearch native RRF",
                                value: "elasticsearch",
                                disabled: !health.data?.capabilities.native_rrf,
                              },
                            ]}
                          />
                        </Form.Item>
                      ) : null}
                      {searchMode === "hybrid" ? (
                        <>
                          <Form.Item
                            name="lexical_fields"
                            label="BM25 fields"
                            rules={[{ required: true, message: "Select at least one BM25 field." }]}
                          >
                            <Select
                              mode="multiple"
                              maxTagCount="responsive"
                              options={(schema.data?.text_fields ?? []).map((field) => ({
                                label: field.name,
                                value: field.name,
                              }))}
                            />
                          </Form.Item>
                          <Form.Item name="lexical_weight" label="BM25 weight">
                            <InputNumber min={0} max={10} step={0.1} className="full-width" />
                          </Form.Item>
                        </>
                      ) : null}
                      <Form.Item name="source_fields" label="Return fields">
                        <Select
                          mode="multiple"
                          maxTagCount="responsive"
                          allowClear
                          options={(schema.data?.fields ?? []).map((field) => ({
                            label: field.name,
                            value: field.name,
                          }))}
                        />
                      </Form.Item>
                      <Form.Item
                        name="filters_json"
                        label="Filter DSL"
                        className="es-filter-dsl"
                        tooltip='A JSON array, for example [{"term":{"category":"docs"}}]'
                      >
                        <Input.TextArea
                          rows={4}
                          spellCheck={false}
                          placeholder='[{"term":{"category":"docs"}}]'
                        />
                      </Form.Item>
                    </div>
                  ),
                },
              ]}
            />

            <div className="es-search-actions">
              <Typography.Text type="secondary">
                {targets.length} vector source{targets.length === 1 ? "" : "s"}
                {searchMode === "hybrid" ? " + BM25" : ""}
              </Typography.Text>
              <Space>
                {runSearch.isPending ? (
                  <Button
                    danger
                    icon={<CircleStop size={16} />}
                    onClick={() => abortRef.current?.abort()}
                  >
                    Cancel
                  </Button>
                ) : null}
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<Search size={16} />}
                  loading={runSearch.isPending}
                >
                  Search
                </Button>
              </Space>
            </div>
          </section>
        </Form>
      )}

      {result ? (
        <section className="surface es-results-surface">
          <div className="es-results-heading">
            <div>
              <Typography.Title level={4}>Results</Typography.Title>
              <Space size={5} wrap>
                <Tag icon={<TimerReset size={13} />}>{formatDuration(result.timings.total_ms)}</Tag>
                <Tag>{result.fusion_backend === "elasticsearch" ? "Native RRF" : "Application ranking"}</Tag>
                {result.embedding_cache_hit ? <Tag color="success">Embedding cached</Tag> : null}
              </Space>
            </div>
            <Button icon={<Braces size={16} />} onClick={() => setInspectorOpen(true)}>
              Inspect requests
            </Button>
          </div>
          {result.result_mode === "compare" ? (
            <Tabs
              items={result.result_sets.map((set) => ({
                key: set.label,
                label: (
                  <Space size={6}>
                    <GitCompareArrows size={14} />
                    {set.label}
                    <Tag>{set.hits.length}</Tag>
                  </Space>
                ),
                children: set.status === "error"
                  ? <Alert type="error" message={errorMessage(set.error)} />
                  : <ResultList hits={set.hits} onInspect={setSelectedHit} />,
              }))}
            />
          ) : (
            <ResultList hits={result.hits} onInspect={setSelectedHit} />
          )}
        </section>
      ) : null}

      <Drawer
        width={640}
        open={inspectorOpen}
        title="Generated Elasticsearch requests"
        onClose={() => setInspectorOpen(false)}
        className="es-query-drawer"
      >
        {result ? (
          <>
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="Index">{result.index}</Descriptions.Item>
              <Descriptions.Item label="Mode">{result.mode}</Descriptions.Item>
              <Descriptions.Item label="Embedding">{formatDuration(result.timings.embedding_ms)}</Descriptions.Item>
              <Descriptions.Item label="Elasticsearch">{formatDuration(result.timings.elasticsearch_ms)}</Descriptions.Item>
            </Descriptions>
            <Collapse
              className="es-request-collapse"
              items={result.generated_requests.map((request, index) => ({
                key: `${request.source}-${index}`,
                label: request.source,
                children: <pre>{JSON.stringify(request.body, null, 2)}</pre>,
              }))}
            />
          </>
        ) : null}
      </Drawer>

      <Drawer
        width={620}
        open={Boolean(selectedHit)}
        title={selectedHit ? resultTitle(selectedHit) : "Document"}
        onClose={() => setSelectedHit(null)}
        className="es-document-drawer"
      >
        {selectedHit ? (
          <>
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="Index">{selectedHit._index}</Descriptions.Item>
              <Descriptions.Item label="ID">{selectedHit._id}</Descriptions.Item>
              <Descriptions.Item label="Score" span={2}>
                {selectedHit._score?.toFixed(7) ?? "Not available"}
              </Descriptions.Item>
            </Descriptions>
            <pre>{JSON.stringify(selectedHit._source, null, 2)}</pre>
          </>
        ) : null}
      </Drawer>

      <Drawer
        width={620}
        open={previewOpen}
        title="Query embedding"
        onClose={() => setPreviewOpen(false)}
        className="es-embedding-drawer"
      >
        {preview.data ? (
          <>
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="Model" span={2}>{preview.data.model}</Descriptions.Item>
              <Descriptions.Item label="Dimensions">{preview.data.dimension}</Descriptions.Item>
              <Descriptions.Item label="L2 norm">{preview.data.statistics.l2_norm.toFixed(5)}</Descriptions.Item>
              <Descriptions.Item label="Embedding">{formatDuration(preview.data.timings.embedding_ms)}</Descriptions.Item>
              <Descriptions.Item label="Cache">{preview.data.cache_hit ? "Hit" : "Miss"}</Descriptions.Item>
            </Descriptions>
            <div className="es-vector-preview">
              <Typography.Text strong>Vector preview</Typography.Text>
              <code>{preview.data.vector.slice(0, 24).map((value) => value.toFixed(5)).join(", ")}</code>
              <Typography.Text type="secondary">
                Showing 24 of {preview.data.dimension} dimensions.
              </Typography.Text>
            </div>
          </>
        ) : null}
      </Drawer>
    </div>
  );
};
