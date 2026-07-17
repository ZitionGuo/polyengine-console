import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Collapse,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { Eye, Filter, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useState } from "react";

import { JsonView } from "../components/JsonView";
import { PageToolbar } from "../components/PageToolbar";
import { api, type AliasSummary, type CollectionSummary } from "../services/api";
import {
  buildCollectionCreatePayload,
  buildIndexSchema,
  type CollectionFormValues,
  type IndexInput,
  type PayloadIndexType,
} from "../services/collectionPayload";
import {
  buildPointRetrievePayload,
  buildPointScrollPayload,
  buildPointQueryPayload,
  defaultPointFilterJson,
  defaultPointIdsJson,
  defaultPointQueryJson,
  defaultPointsJson,
  hasPointFilter,
  normalizePointFilterJson,
  parseUpsertPointsInput,
} from "../services/points";

type AnyRecord = Record<string, unknown>;

interface VectorRow {
  key: string;
  name: string;
  size: string;
  distance: string;
  onDisk: string;
}

interface PayloadSchemaRow {
  key: string;
  field: string;
  schema: string;
}

interface PointRow {
  key: string;
  pointId: unknown;
  id: string;
  score: string;
  payload: string;
  vector: string;
  raw: unknown;
}

interface VectorOption {
  value: string;
  label: string;
}

interface CollectionDetailsProps {
  data: unknown;
  collectionName: string;
  aliases: AliasSummary[];
  aliasesLoading: boolean;
  aliasesError?: Error;
  deletingIndexField?: string;
  onAddAlias: () => void;
  onAddIndex: () => void;
  onDeleteIndex: (fieldName: string) => void;
}

const asRecord = (value: unknown): AnyRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : {};

const asNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const unwrapResult = (value: unknown) => asRecord(asRecord(value).result ?? value);

const displayValue = (value: unknown) => {
  if (value === undefined || value === null || value === "") return "Default";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
};

const compactJson = (value: unknown) => {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

const summarizeJson = (value: unknown, fallback = "None") => {
  if (value === undefined || value === null) return fallback;
  const text = compactJson(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
};

const buildVectorRows = (params: AnyRecord): VectorRow[] => {
  const vectors = asRecord(params.vectors);
  if ("size" in vectors || "distance" in vectors) {
    return [
      {
        key: "default",
        name: "default",
        size: displayValue(vectors.size),
        distance: displayValue(vectors.distance),
        onDisk: displayValue(vectors.on_disk),
      },
    ];
  }

  return Object.entries(vectors).map(([name, config]) => {
    const vectorConfig = asRecord(config);
    return {
      key: name,
      name,
      size: displayValue(vectorConfig.size),
      distance: displayValue(vectorConfig.distance),
      onDisk: displayValue(vectorConfig.on_disk),
    };
  });
};

const buildSparseRows = (params: AnyRecord): VectorRow[] =>
  Object.entries(asRecord(params.sparse_vectors)).map(([name, config]) => {
    const sparseConfig = asRecord(config);
    const index = asRecord(sparseConfig.index);
    return {
      key: name,
      name,
      size: "Sparse",
      distance: displayValue(sparseConfig.modifier),
      onDisk: displayValue(index.on_disk),
    };
  });

const buildPayloadRows = (payloadSchema: AnyRecord): PayloadSchemaRow[] =>
  Object.entries(payloadSchema).map(([field, schema]) => ({
    key: field,
    field,
    schema: compactJson(schema),
  }));

const buildDenseVectorOptions = (params: AnyRecord): VectorOption[] => {
  const vectors = asRecord(params.vectors);
  if ("size" in vectors || "distance" in vectors) {
    return [{ value: "", label: `default (${displayValue(vectors.size)} dims)` }];
  }

  return Object.entries(vectors).map(([name, config]) => {
    const vectorConfig = asRecord(config);
    return {
      value: name,
      label: `${name} (${displayValue(vectorConfig.size)} dims)`,
    };
  });
};

const buildPointRows = (points: unknown): PointRow[] =>
  (Array.isArray(points) ? points : []).map((point, index) => {
    const row = asRecord(point);
    const id = summarizeJson(row.id, `point-${index}`);
    const vector = row.vector;
    let vectorSummary = "Hidden";
    if (Array.isArray(vector)) {
      vectorSummary = `${vector.length} dims`;
    } else if (vector && typeof vector === "object") {
      vectorSummary = `${Object.keys(vector).length} vector(s)`;
    } else if (vector === null) {
      vectorSummary = "None";
    }

    return {
      key: id,
      pointId: row.id,
      id,
      score:
        row.score === undefined || row.score === null
          ? "-"
          : typeof row.score === "number"
            ? row.score.toFixed(4)
            : String(row.score),
      payload: summarizeJson(row.payload),
      vector: vectorSummary,
      raw: point,
    };
  });

const vectorColumns: ColumnsType<VectorRow> = [
  { title: "Name", dataIndex: "name" },
  { title: "Size", dataIndex: "size", width: 120 },
  { title: "Distance / modifier", dataIndex: "distance", width: 170 },
  { title: "On disk", dataIndex: "onDisk", width: 120 },
];

const CollectionDetails = ({
  data,
  collectionName,
  aliases,
  aliasesLoading,
  aliasesError,
  deletingIndexField,
  onAddAlias,
  onAddIndex,
  onDeleteIndex,
}: CollectionDetailsProps) => {
  const details = unwrapResult(data);
  const config = asRecord(details.config);
  const params = asRecord(config.params);
  const hnsw = asRecord(config.hnsw_config);
  const optimizer = asRecord(config.optimizer_config);
  const wal = asRecord(config.wal_config);
  const vectorRows = [...buildVectorRows(params), ...buildSparseRows(params)];
  const denseVectorOptions = buildDenseVectorOptions(params);
  const payloadRows = buildPayloadRows(asRecord(details.payload_schema));
  const payloadColumns: ColumnsType<PayloadSchemaRow> = [
    { title: "Field", dataIndex: "field", width: 220 },
    {
      title: "Schema",
      dataIndex: "schema",
      render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
    },
    {
      title: "Actions",
      width: 96,
      align: "right",
      render: (_, row) => (
        <Tooltip title="Delete payload index">
          <Button
            danger
            aria-label={`Delete index ${row.field}`}
            icon={<Trash2 size={16} />}
            loading={deletingIndexField === row.field}
            onClick={() => onDeleteIndex(row.field)}
          />
        </Tooltip>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div className="metrics-grid collection-metrics">
        <div className="metric-tile">
          <Statistic
            title="Status"
            value={String(details.status ?? "unknown")}
            valueStyle={{ color: details.status === "green" ? "#286c4f" : undefined }}
          />
        </div>
        <div className="metric-tile">
          <Statistic title="Points" value={asNumber(details.points_count)} />
        </div>
        <div className="metric-tile">
          <Statistic title="Segments" value={asNumber(details.segments_count)} />
        </div>
        <div className="metric-tile">
          <Statistic title="Indexed vectors" value={asNumber(details.indexed_vectors_count)} />
        </div>
      </div>

      <Descriptions
        bordered
        size="small"
        column={2}
        items={[
          { key: "optimizer", label: "Optimizer", children: displayValue(details.optimizer_status) },
          { key: "shards", label: "Shards", children: displayValue(params.shard_number) },
          { key: "replicas", label: "Replicas", children: displayValue(params.replication_factor) },
          { key: "write", label: "Write consistency", children: displayValue(params.write_consistency_factor) },
          { key: "payload", label: "On-disk payload", children: displayValue(params.on_disk_payload) },
          { key: "queue", label: "Update queue", children: displayValue(asRecord(details.update_queue).length) },
        ]}
      />

      <section>
        <div className="section-heading">
          <Typography.Title level={4}>Aliases</Typography.Title>
          <Button icon={<Plus size={16} />} onClick={onAddAlias}>
            New alias
          </Button>
        </div>
        {aliasesError ? (
          <Alert
            type="warning"
            showIcon
            message="Unable to load aliases"
            description={aliasesError.message}
          />
        ) : aliasesLoading ? (
          <Spin />
        ) : aliases.length ? (
          <Space wrap>
            {aliases.map((alias) => (
              <Tag key={alias.alias_name} color="blue">
                {alias.alias_name}
              </Tag>
            ))}
          </Space>
        ) : (
          <Empty
            description={`No aliases point to ${collectionName}`}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
      </section>

      <section>
        <Typography.Title level={4}>Vectors</Typography.Title>
        {vectorRows.length ? (
          <Table rowKey="key" size="small" columns={vectorColumns} dataSource={vectorRows} pagination={false} />
        ) : (
          <Empty description="No dense or sparse vectors reported" />
        )}
      </section>

      <section>
        <div className="section-heading">
          <Typography.Title level={4}>Payload indexes</Typography.Title>
          <Button icon={<Plus size={16} />} onClick={onAddIndex}>
            Add index
          </Button>
        </div>
        {payloadRows.length ? (
          <Table rowKey="key" size="small" columns={payloadColumns} dataSource={payloadRows} pagination={false} />
        ) : (
          <Empty
            description={`No payload indexes in ${collectionName}`}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
      </section>

      <CollectionPointsPreview collectionName={collectionName} vectorOptions={denseVectorOptions} />

      <Collapse
        size="small"
        items={[
          {
            key: "engine",
            label: "Engine configuration",
            children: (
              <Descriptions
                bordered
                size="small"
                column={2}
                items={[
                  { key: "hnsw-m", label: "HNSW m", children: displayValue(hnsw.m) },
                  { key: "hnsw-ef", label: "HNSW ef construct", children: displayValue(hnsw.ef_construct) },
                  { key: "hnsw-disk", label: "HNSW on disk", children: displayValue(hnsw.on_disk) },
                  { key: "flush", label: "Flush interval", children: `${displayValue(optimizer.flush_interval_sec)} sec` },
                  { key: "wal", label: "WAL capacity", children: `${displayValue(wal.wal_capacity_mb)} MB` },
                  { key: "quantization", label: "Quantization", children: displayValue(config.quantization_config) },
                ]}
              />
            ),
          },
          {
            key: "raw",
            label: "Raw collection response",
            children: <JsonView data={data} minHeight={260} />,
          },
        ]}
      />
    </Space>
  );
};

const CollectionPointsPreview = ({
  collectionName,
  vectorOptions,
}: {
  collectionName: string;
  vectorOptions: VectorOption[];
}) => {
  const { message, modal } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState<unknown>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDraftJson, setFilterDraftJson] = useState(defaultPointFilterJson);
  const [activeFilterJson, setActiveFilterJson] = useState(defaultPointFilterJson);
  const [retrieveOpen, setRetrieveOpen] = useState(false);
  const [retrieveIdsJson, setRetrieveIdsJson] = useState(defaultPointIdsJson);
  const [retrieveWithVector, setRetrieveWithVector] = useState(false);
  const [upsertOpen, setUpsertOpen] = useState(false);
  const [upsertJson, setUpsertJson] = useState(defaultPointsJson);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQueryJson, setSearchQueryJson] = useState(defaultPointQueryJson);
  const [searchFilterJson, setSearchFilterJson] = useState("{}");
  const [searchLimit, setSearchLimit] = useState(10);
  const [searchUsing, setSearchUsing] = useState<string | undefined>(undefined);
  const [searchWithVector, setSearchWithVector] = useState(false);
  const filterActive = hasPointFilter(activeFilterJson);
  const pointsQuery = useQuery({
    queryKey: ["collections", collectionName, "points", limit, offset, activeFilterJson],
    queryFn: () =>
      api.scrollPoints(collectionName, buildPointScrollPayload({
        limit,
        offset,
        filterText: activeFilterJson,
      })),
    enabled: Boolean(collectionName),
  });
  const result = unwrapResult(pointsQuery.data);
  const pointRows = buildPointRows(result.points);
  const nextOffset = result.next_page_offset;
  const deletePointMutation = useMutation({
    mutationFn: (pointId: unknown) =>
      api.deletePoints(collectionName, {
        points: [pointId],
        wait: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections", collectionName, "points"] });
      queryClient.invalidateQueries({ queryKey: ["collections", collectionName] });
      message.success("Point deleted.");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "Failed to delete point.");
    },
  });

  const upsertPointsMutation = useMutation({
    mutationFn: async () => {
      const points = parseUpsertPointsInput(upsertJson);
      return api.upsertPoints(collectionName, { points, wait: true });
    },
    onSuccess: () => {
      setUpsertOpen(false);
      setOffset(undefined);
      queryClient.invalidateQueries({ queryKey: ["collections", collectionName, "points"] });
      queryClient.invalidateQueries({ queryKey: ["collections", collectionName] });
      message.success("Points upserted.");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "Failed to upsert points.");
    },
  });

  const retrievePointsMutation = useMutation({
    mutationFn: async () =>
      api.retrievePoints(
        collectionName,
        buildPointRetrievePayload({
          idsText: retrieveIdsJson,
          withVector: retrieveWithVector,
        }),
      ),
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "Failed to retrieve points.");
    },
  });

  const searchPointsMutation = useMutation({
    mutationFn: async () =>
      api.queryPoints(
        collectionName,
        buildPointQueryPayload({
          queryText: searchQueryJson,
          filterText: searchFilterJson,
          using: searchUsing,
          limit: searchLimit,
          withVector: searchWithVector,
        }),
      ),
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "Failed to query points.");
    },
  });

  const confirmDeletePoint = (row: PointRow) => {
    modal.confirm({
      title: `Delete point ${row.id}?`,
      content: "This removes the point from the collection.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: () => deletePointMutation.mutateAsync(row.pointId),
    });
  };

  const applyScrollFilter = () => {
    try {
      const normalized = normalizePointFilterJson(filterDraftJson);
      setActiveFilterJson(normalized);
      setFilterDraftJson(normalized);
      setOffset(undefined);
      setFilterOpen(false);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Invalid filter JSON.");
    }
  };

  const clearScrollFilter = () => {
    setActiveFilterJson(defaultPointFilterJson);
    setFilterDraftJson(defaultPointFilterJson);
    setOffset(undefined);
  };

  const pointColumns: ColumnsType<PointRow> = [
    {
      title: "Point ID",
      dataIndex: "id",
      width: 210,
      render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
    },
    {
      title: "Payload",
      dataIndex: "payload",
      render: (value: string) => (
        <Typography.Text className="truncate-cell" title={value}>
          {value}
        </Typography.Text>
      ),
    },
    { title: "Vector", dataIndex: "vector", width: 120 },
    {
      title: "Actions",
      width: 96,
      align: "right",
      render: (_, row) => (
        <Tooltip title="Delete point">
          <Button
            danger
            aria-label={`Delete point ${row.id}`}
            icon={<Trash2 size={16} />}
            loading={deletePointMutation.isPending && deletePointMutation.variables === row.pointId}
            onClick={() => confirmDeletePoint(row)}
          />
        </Tooltip>
      ),
    },
  ];
  const searchPointColumns: ColumnsType<PointRow> = [
    {
      title: "Point ID",
      dataIndex: "id",
      width: 180,
      render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
    },
    { title: "Score", dataIndex: "score", width: 100 },
    {
      title: "Payload",
      dataIndex: "payload",
      render: (value: string) => (
        <Typography.Text className="truncate-cell" title={value}>
          {value}
        </Typography.Text>
      ),
    },
    { title: "Vector", dataIndex: "vector", width: 110 },
  ];
  const retrievePointColumns: ColumnsType<PointRow> = [
    {
      title: "Point ID",
      dataIndex: "id",
      width: 180,
      render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
    },
    {
      title: "Payload",
      dataIndex: "payload",
      render: (value: string) => (
        <Typography.Text className="truncate-cell" title={value}>
          {value}
        </Typography.Text>
      ),
    },
    { title: "Vector", dataIndex: "vector", width: 110 },
  ];
  const searchResult = unwrapResult(searchPointsMutation.data);
  const searchRows = buildPointRows(searchResult.points);
  const retrieveEnvelope = asRecord(retrievePointsMutation.data);
  const retrieveResult = retrieveEnvelope.result;
  const retrieveRows = buildPointRows(
    Array.isArray(retrieveResult) ? retrieveResult : asRecord(retrieveResult).points,
  );

  return (
    <section>
      <div className="section-heading">
        <Typography.Title level={4}>Points preview</Typography.Title>
        <Space wrap>
          {filterActive ? <Tag color="blue">filtered</Tag> : null}
          <Button
            icon={<Filter size={16} />}
            type={filterActive ? "primary" : "default"}
            onClick={() => {
              setFilterDraftJson(activeFilterJson);
              setFilterOpen(true);
            }}
          >
            Filter
          </Button>
          {filterActive ? (
            <Tooltip title="Clear point filter">
              <Button icon={<X size={16} />} onClick={clearScrollFilter} />
            </Tooltip>
          ) : null}
          <Button icon={<Eye size={16} />} onClick={() => setRetrieveOpen(true)}>
            Retrieve
          </Button>
          <Button icon={<Search size={16} />} onClick={() => setSearchOpen(true)}>
            Search points
          </Button>
          <Button icon={<Plus size={16} />} onClick={() => setUpsertOpen(true)}>
            Upsert points
          </Button>
          <InputNumber
            min={1}
            max={100}
            precision={0}
            value={limit}
            onChange={(value) => {
              setLimit(value ?? 10);
              setOffset(undefined);
            }}
          />
          <Tooltip title="Refresh points">
            <Button
              icon={<RefreshCw size={16} />}
              loading={pointsQuery.isFetching}
              onClick={() => pointsQuery.refetch()}
            />
          </Tooltip>
        </Space>
      </div>
      {pointsQuery.isError ? (
        <Alert
          type="warning"
          showIcon
          message="Unable to load points"
          description={pointsQuery.error instanceof Error ? pointsQuery.error.message : undefined}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <Table
        rowKey="key"
        size="small"
        columns={pointColumns}
        dataSource={pointRows}
        loading={pointsQuery.isLoading || pointsQuery.isFetching}
        pagination={false}
        expandable={{
          expandedRowRender: (row) => <JsonView data={row.raw} minHeight={140} />,
        }}
        locale={{ emptyText: pointsQuery.isError ? "Unable to load points" : "No points returned" }}
      />
      <div className="table-footer-actions">
        <Button disabled={offset === undefined} onClick={() => setOffset(undefined)}>
          First page
        </Button>
        <Button
          type="primary"
          disabled={nextOffset === undefined || nextOffset === null}
          onClick={() => setOffset(nextOffset)}
        >
          Next page
        </Button>
      </div>
      <Modal
        title={`Filter points in ${collectionName}`}
        open={filterOpen}
        okText="Apply filter"
        width={720}
        onOk={applyScrollFilter}
        onCancel={() => setFilterOpen(false)}
      >
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="Use Qdrant filter JSON to browse matching points."
            description='Example: {"must":[{"key":"group","match":{"value":"a"}}]}'
          />
          <Input.TextArea
            value={filterDraftJson}
            rows={10}
            spellCheck={false}
            onChange={(event) => setFilterDraftJson(event.target.value)}
          />
        </Space>
      </Modal>
      <Modal
        title={`Retrieve points from ${collectionName}`}
        open={retrieveOpen}
        okText="Retrieve"
        width={760}
        confirmLoading={retrievePointsMutation.isPending}
        onOk={() => retrievePointsMutation.mutate()}
        onCancel={() => setRetrieveOpen(false)}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="Paste point IDs as a JSON array, or an object with an ids array."
            description='Examples: [1, 2], ["uuid-value"], or {"ids":[1,"abc"]}'
          />
          <div className="form-grid two">
            <div>
              <Typography.Text strong>Point IDs JSON</Typography.Text>
              <Input.TextArea
                value={retrieveIdsJson}
                rows={6}
                spellCheck={false}
                onChange={(event) => setRetrieveIdsJson(event.target.value)}
              />
            </div>
            <div>
              <Typography.Text strong>Return vectors</Typography.Text>
              <div style={{ marginTop: 10 }}>
                <Switch checked={retrieveWithVector} onChange={setRetrieveWithVector} />
              </div>
            </div>
          </div>
          {retrievePointsMutation.isError ? (
            <Alert
              type="warning"
              showIcon
              message="Unable to retrieve points"
              description={
                retrievePointsMutation.error instanceof Error
                  ? retrievePointsMutation.error.message
                  : undefined
              }
            />
          ) : null}
          {retrievePointsMutation.data ? (
            <Table
              rowKey="key"
              size="small"
              columns={retrievePointColumns}
              dataSource={retrieveRows}
              loading={retrievePointsMutation.isPending}
              pagination={false}
              expandable={{
                expandedRowRender: (row) => <JsonView data={row.raw} minHeight={140} />,
              }}
              locale={{ emptyText: "No points found for those IDs" }}
            />
          ) : null}
        </Space>
      </Modal>
      <Modal
        title={`Upsert points into ${collectionName}`}
        open={upsertOpen}
        okText="Upsert"
        width={720}
        confirmLoading={upsertPointsMutation.isPending}
        onOk={() => upsertPointsMutation.mutate()}
        onCancel={() => setUpsertOpen(false)}
      >
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="Paste a point array, or an object with a points array."
            description='Example point fields: "id", "vector", "payload". Named vectors and sparse vectors are accepted as normal Qdrant point JSON.'
          />
          <Input.TextArea
            value={upsertJson}
            rows={14}
            spellCheck={false}
            onChange={(event) => setUpsertJson(event.target.value)}
          />
        </Space>
      </Modal>
      <Modal
        title={`Search points in ${collectionName}`}
        open={searchOpen}
        okText="Search"
        width={860}
        confirmLoading={searchPointsMutation.isPending}
        onOk={() => searchPointsMutation.mutate()}
        onCancel={() => setSearchOpen(false)}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div className="form-grid two">
            <div>
              <Typography.Text strong>Vector</Typography.Text>
              <Select
                allowClear
                value={searchUsing}
                placeholder="Default vector"
                options={vectorOptions}
                style={{ width: "100%", marginTop: 6 }}
                onChange={(value) => setSearchUsing(value || undefined)}
              />
            </div>
            <div className="form-grid two">
              <div>
                <Typography.Text strong>Limit</Typography.Text>
                <InputNumber
                  min={1}
                  max={100}
                  precision={0}
                  value={searchLimit}
                  style={{ width: "100%", marginTop: 6 }}
                  onChange={(value) => setSearchLimit(value ?? 10)}
                />
              </div>
              <div>
                <Typography.Text strong>Return vectors</Typography.Text>
                <div style={{ marginTop: 10 }}>
                  <Switch checked={searchWithVector} onChange={setSearchWithVector} />
                </div>
              </div>
            </div>
          </div>
          <div>
            <Typography.Text strong>Query JSON</Typography.Text>
            <Input.TextArea
              rows={4}
              value={searchQueryJson}
              spellCheck={false}
              onChange={(event) => setSearchQueryJson(event.target.value)}
            />
          </div>
          <div>
            <Typography.Text strong>Filter JSON</Typography.Text>
            <Input.TextArea
              rows={5}
              value={searchFilterJson}
              spellCheck={false}
              onChange={(event) => setSearchFilterJson(event.target.value)}
            />
          </div>
          {searchPointsMutation.isError ? (
            <Alert
              type="warning"
              showIcon
              message="Unable to query points"
              description={
                searchPointsMutation.error instanceof Error
                  ? searchPointsMutation.error.message
                  : undefined
              }
            />
          ) : null}
          {searchPointsMutation.data ? (
            <Table
              rowKey="key"
              size="small"
              columns={searchPointColumns}
              dataSource={searchRows}
              loading={searchPointsMutation.isPending}
              pagination={false}
              expandable={{
                expandedRowRender: (row) => <JsonView data={row.raw} minHeight={140} />,
              }}
              locale={{ emptyText: "No matching points" }}
            />
          ) : null}
        </Space>
      </Modal>
    </section>
  );
};

const distanceOptions = ["Cosine", "Euclid", "Dot", "Manhattan"].map((value) => ({
  value,
  label: value,
}));

const indexTypeOptions: PayloadIndexType[] = [
  "keyword",
  "integer",
  "float",
  "bool",
  "geo",
  "datetime",
  "text",
  "uuid",
];

const defaultValues: CollectionFormValues = {
  vectorMode: "single",
  singleVector: { size: 384, distance: "Cosine" },
  namedVectors: [{ name: "default", size: 384, distance: "Cosine" }],
  sparseVectors: [],
  indexes: [],
  replicationFactor: 1,
  writeConsistencyFactor: 1,
  onDiskPayload: true,
};

export const CollectionsPage = () => {
  const { message, modal } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);
  const [aliasOpen, setAliasOpen] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [form] = Form.useForm<CollectionFormValues>();
  const [indexForm] = Form.useForm<IndexInput>();
  const [aliasForm] = Form.useForm<{ aliasName: string }>();
  const vectorMode = Form.useWatch("vectorMode", form) ?? "single";
  const indexType = Form.useWatch("type", indexForm);

  const collectionsQuery = useQuery({
    queryKey: ["collections"],
    queryFn: api.listCollections,
  });

  const aliasesQuery = useQuery({
    queryKey: ["aliases"],
    queryFn: api.listAliases,
    enabled: Boolean(selectedCollection),
  });

  const detailsQuery = useQuery({
    queryKey: ["collections", selectedCollection],
    queryFn: () => api.getCollection(selectedCollection!),
    enabled: Boolean(selectedCollection),
  });

  const createMutation = useMutation({
    mutationFn: async (values: CollectionFormValues) => {
      const { name, body } = buildCollectionCreatePayload(values);
      return api.createCollection(name, body);
    },
    onSuccess: (result) => {
      setCreateOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      if (result.index_errors.length) {
        message.warning("Collection created, but one or more payload indexes failed.");
        return;
      }
      message.success("Collection created.");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "Failed to create collection.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteCollection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      setSelectedCollection(null);
      message.success("Collection deleted.");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "Failed to delete collection.");
    },
  });

  const createAliasMutation = useMutation({
    mutationFn: async (values: { aliasName: string }) => {
      const collectionName = selectedCollection;
      const aliasName = values.aliasName?.trim();
      if (!collectionName || !aliasName) {
        throw new Error("Collection and alias are required.");
      }
      return api.createAlias(collectionName, aliasName);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["aliases"] });
      setAliasOpen(false);
      aliasForm.resetFields();
      message.success("Alias created.");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "Failed to create alias.");
    },
  });

  const createIndexMutation = useMutation({
    mutationFn: async (values: IndexInput) => {
      const collectionName = selectedCollection;
      const fieldName = values.fieldName?.trim();
      if (!collectionName || !fieldName) {
        throw new Error("Collection and field name are required.");
      }
      return api.createIndex(collectionName, fieldName, buildIndexSchema(values));
    },
    onSuccess: () => {
      if (selectedCollection) {
        queryClient.invalidateQueries({ queryKey: ["collections", selectedCollection] });
      }
      setIndexOpen(false);
      indexForm.resetFields();
      message.success("Payload index created.");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "Failed to create payload index.");
    },
  });

  const deleteIndexMutation = useMutation({
    mutationFn: async (fieldName: string) => {
      if (!selectedCollection) {
        throw new Error("Collection is required.");
      }
      return api.deleteIndex(selectedCollection, fieldName);
    },
    onSuccess: () => {
      if (selectedCollection) {
        queryClient.invalidateQueries({ queryKey: ["collections", selectedCollection] });
      }
      message.success("Payload index deleted.");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "Failed to delete payload index.");
    },
  });

  const openIndexModal = () => {
    indexForm.setFieldsValue({ type: "keyword" });
    setIndexOpen(true);
  };

  const openAliasModal = () => {
    aliasForm.resetFields();
    setAliasOpen(true);
  };

  const confirmDeleteIndex = (fieldName: string) => {
    modal.confirm({
      title: `Delete index ${fieldName}?`,
      content: "The collection data remains; Qdrant removes only this payload index.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: () => deleteIndexMutation.mutateAsync(fieldName),
    });
  };

  const collections = collectionsQuery.data?.result?.collections ?? [];
  const collectionAliases =
    aliasesQuery.data?.result?.aliases.filter((alias) => alias.collection_name === selectedCollection) ?? [];

  const columns: ColumnsType<CollectionSummary> = [
    {
      title: "Collection",
      dataIndex: "name",
      render: (name: string) => (
        <Space>
          <Typography.Text strong>{name}</Typography.Text>
          <Tag color="green">active</Tag>
        </Space>
      ),
    },
    {
      title: "Actions",
      width: 150,
      align: "right",
      render: (_, record) => (
        <Space>
          <Tooltip title="View details">
            <Button
              aria-label={`View ${record.name}`}
              icon={<Eye size={16} />}
              onClick={() => setSelectedCollection(record.name)}
            />
          </Tooltip>
          <Tooltip title="Delete collection">
            <Button
              danger
              aria-label={`Delete ${record.name}`}
              icon={<Trash2 size={16} />}
              onClick={() =>
                modal.confirm({
                  title: `Delete ${record.name}?`,
                  content: "This removes the collection and its data from Qdrant.",
                  okText: "Delete",
                  okButtonProps: { danger: true },
                  onOk: () => deleteMutation.mutateAsync(record.name),
                })
              }
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageToolbar
        title="Collections"
        subtitle="Create, inspect, index, and remove local Qdrant collections."
        actions={
          <>
            <Tooltip title="Refresh">
              <Button
                icon={<RefreshCw size={16} />}
                onClick={() => collectionsQuery.refetch()}
                loading={collectionsQuery.isFetching}
              />
            </Tooltip>
            <Button
              type="primary"
              icon={<Plus size={16} />}
              onClick={() => {
                form.setFieldsValue(defaultValues);
                setCreateOpen(true);
              }}
            >
              New collection
            </Button>
          </>
        }
      />

      {collectionsQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message="Unable to load collections"
          description={collectionsQuery.error instanceof Error ? collectionsQuery.error.message : undefined}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <div className="surface table-surface">
        <Table
          rowKey="name"
          columns={columns}
          dataSource={collections}
          loading={collectionsQuery.isLoading || collectionsQuery.isFetching}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
        />
      </div>

      <Drawer
        title={selectedCollection}
        open={Boolean(selectedCollection)}
        width={760}
        onClose={() => setSelectedCollection(null)}
      >
        {detailsQuery.isLoading ? <Spin /> : null}
        {detailsQuery.isError ? (
          <Alert
            type="error"
            showIcon
            message="Unable to load collection details"
            description={detailsQuery.error instanceof Error ? detailsQuery.error.message : undefined}
          />
        ) : null}
        {detailsQuery.data && selectedCollection ? (
          <CollectionDetails
            data={detailsQuery.data}
            collectionName={selectedCollection}
            aliases={collectionAliases}
            aliasesLoading={aliasesQuery.isLoading || aliasesQuery.isFetching}
            aliasesError={aliasesQuery.error instanceof Error ? aliasesQuery.error : undefined}
            deletingIndexField={deleteIndexMutation.isPending ? deleteIndexMutation.variables : undefined}
            onAddAlias={openAliasModal}
            onAddIndex={openIndexModal}
            onDeleteIndex={confirmDeleteIndex}
          />
        ) : null}
      </Drawer>

      <Modal
        title={`Create alias${selectedCollection ? ` for ${selectedCollection}` : ""}`}
        open={aliasOpen}
        okText="Create alias"
        confirmLoading={createAliasMutation.isPending}
        onOk={() => aliasForm.submit()}
        onCancel={() => setAliasOpen(false)}
      >
        <Form
          form={aliasForm}
          layout="vertical"
          onFinish={(values) => createAliasMutation.mutate(values)}
        >
          <Form.Item
            label="Alias"
            name="aliasName"
            rules={[{ required: true, message: "Alias is required." }]}
          >
            <Input placeholder={`${selectedCollection ?? "collection"}_live`} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Add payload index${selectedCollection ? ` to ${selectedCollection}` : ""}`}
        open={indexOpen}
        okText="Create index"
        confirmLoading={createIndexMutation.isPending}
        onOk={() => indexForm.submit()}
        onCancel={() => setIndexOpen(false)}
      >
        <Form
          form={indexForm}
          layout="vertical"
          initialValues={{ type: "keyword" }}
          onFinish={(values) => createIndexMutation.mutate(values)}
        >
          <div className="form-grid two">
            <Form.Item
              label="Field"
              name="fieldName"
              rules={[{ required: true, message: "Field name is required." }]}
            >
              <Input placeholder="metadata.source" />
            </Form.Item>
            <Form.Item
              label="Type"
              name="type"
              rules={[{ required: true, message: "Index type is required." }]}
            >
              <Select options={indexTypeOptions.map((value) => ({ value, label: value }))} />
            </Form.Item>
          </div>
          <div className="form-grid two">
            <Form.Item label="On disk" name="onDisk" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item label="Tenant optimized" name="isTenant" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
          {indexType === "text" ? (
            <div className="form-grid two">
              <Form.Item label="Tokenizer" name="tokenizer">
                <Select
                  options={["word", "whitespace", "prefix", "multilingual"].map((value) => ({
                    value,
                    label: value,
                  }))}
                />
              </Form.Item>
              <Form.Item label="Lowercase" name="lowercase" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item label="Min token length" name="minTokenLen">
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item label="Max token length" name="maxTokenLen">
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </div>
          ) : null}
        </Form>
      </Modal>

      <Modal
        title="Create collection"
        open={createOpen}
        width={920}
        okText="Create"
        confirmLoading={createMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => setCreateOpen(false)}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={defaultValues}
          onFinish={(values) => createMutation.mutate(values)}
        >
          <div className="form-grid">
            <Form.Item
              label="Collection name"
              name="name"
              rules={[{ required: true, message: "Collection name is required." }]}
            >
              <Input placeholder="documents" />
            </Form.Item>
            <Form.Item label="Vector mode" name="vectorMode">
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                options={[
                  { label: "Single", value: "single" },
                  { label: "Named", value: "named" },
                ]}
              />
            </Form.Item>
            <Form.Item label="On-disk payload" name="onDiskPayload" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>

          {vectorMode === "single" ? (
            <div className="form-grid">
              <Form.Item
                label="Vector size"
                name={["singleVector", "size"]}
                rules={[{ required: true, message: "Size is required." }]}
              >
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item
                label="Distance"
                name={["singleVector", "distance"]}
                rules={[{ required: true, message: "Distance is required." }]}
              >
                <Select options={distanceOptions} />
              </Form.Item>
              <Form.Item label="Vector on disk" name={["singleVector", "onDisk"]} valuePropName="checked">
                <Switch />
              </Form.Item>
            </div>
          ) : (
            <Form.List name="namedVectors">
              {(fields, { add, remove }) => (
                <div className="dynamic-list">
                  {fields.map((field) => (
                    <div className="form-row" key={field.key}>
                      <Form.Item
                        label="Name"
                        name={[field.name, "name"]}
                        rules={[{ required: true, message: "Name is required." }]}
                      >
                        <Input placeholder="image" />
                      </Form.Item>
                      <Form.Item
                        label="Size"
                        name={[field.name, "size"]}
                        rules={[{ required: true, message: "Size is required." }]}
                      >
                        <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                      </Form.Item>
                      <Form.Item
                        label="Distance"
                        name={[field.name, "distance"]}
                        rules={[{ required: true, message: "Distance is required." }]}
                      >
                        <Select options={distanceOptions} />
                      </Form.Item>
                      <Form.Item label="On disk" name={[field.name, "onDisk"]} valuePropName="checked">
                        <Switch />
                      </Form.Item>
                      <Form.Item label=" ">
                        <Button danger icon={<Trash2 size={16} />} onClick={() => remove(field.name)} />
                      </Form.Item>
                    </div>
                  ))}
                  <Button icon={<Plus size={16} />} onClick={() => add({ size: 384, distance: "Cosine" })}>
                    Add named vector
                  </Button>
                </div>
              )}
            </Form.List>
          )}

          <Divider orientation="left">Replica and shards</Divider>
          <div className="form-grid">
            <Form.Item label="Shard number" name="shardNumber">
              <InputNumber min={1} precision={0} style={{ width: "100%" }} placeholder="Qdrant default" />
            </Form.Item>
            <Form.Item label="Replication factor" name="replicationFactor">
              <InputNumber min={1} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="Write consistency" name="writeConsistencyFactor">
              <InputNumber min={1} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </div>

          <Divider orientation="left">Sparse vectors</Divider>
          <Form.List name="sparseVectors">
            {(fields, { add, remove }) => (
              <div className="dynamic-list">
                {fields.map((field) => (
                  <div className="form-row compact" key={field.key}>
                    <Form.Item label="Name" name={[field.name, "name"]}>
                      <Input placeholder="text-sparse" />
                    </Form.Item>
                    <Form.Item label="Modifier" name={[field.name, "modifier"]}>
                      <Select
                        options={[
                          { value: "none", label: "None" },
                          { value: "idf", label: "IDF" },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item label="On disk" name={[field.name, "onDisk"]} valuePropName="checked">
                      <Switch />
                    </Form.Item>
                    <Form.Item label=" ">
                      <Button danger icon={<Trash2 size={16} />} onClick={() => remove(field.name)} />
                    </Form.Item>
                  </div>
                ))}
                <Button icon={<Plus size={16} />} onClick={() => add({ modifier: "none" })}>
                  Add sparse vector
                </Button>
              </div>
            )}
          </Form.List>

          <Divider orientation="left">Payload indexes</Divider>
          <Form.List name="indexes">
            {(fields, { add, remove }) => (
              <div className="dynamic-list">
                {fields.map((field) => (
                  <div className="form-row compact" key={field.key}>
                    <Form.Item label="Field" name={[field.name, "fieldName"]}>
                      <Input placeholder="metadata.source" />
                    </Form.Item>
                    <Form.Item label="Type" name={[field.name, "type"]}>
                      <Select options={indexTypeOptions.map((value) => ({ value, label: value }))} />
                    </Form.Item>
                    <Form.Item label="On disk" name={[field.name, "onDisk"]} valuePropName="checked">
                      <Switch />
                    </Form.Item>
                    <Form.Item label="Tenant" name={[field.name, "isTenant"]} valuePropName="checked">
                      <Switch />
                    </Form.Item>
                    <Form.Item label=" ">
                      <Button danger icon={<Trash2 size={16} />} onClick={() => remove(field.name)} />
                    </Form.Item>
                    <Form.Item shouldUpdate noStyle>
                      {({ getFieldValue }) => {
                        const type = getFieldValue(["indexes", field.name, "type"]);
                        if (type !== "text") return null;
                        return (
                          <div className="form-row compact">
                            <Form.Item label="Tokenizer" name={[field.name, "tokenizer"]}>
                              <Select
                                options={["word", "whitespace", "prefix", "multilingual"].map((value) => ({
                                  value,
                                  label: value,
                                }))}
                              />
                            </Form.Item>
                            <Form.Item label="Min token" name={[field.name, "minTokenLen"]}>
                              <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                            </Form.Item>
                            <Form.Item label="Max token" name={[field.name, "maxTokenLen"]}>
                              <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                            </Form.Item>
                            <Form.Item label="Lowercase" name={[field.name, "lowercase"]} valuePropName="checked">
                              <Switch />
                            </Form.Item>
                          </div>
                        );
                      }}
                    </Form.Item>
                  </div>
                ))}
                <Button icon={<Plus size={16} />} onClick={() => add({ type: "keyword" })}>
                  Add payload index
                </Button>
              </div>
            )}
          </Form.List>

          <Divider orientation="left">Advanced JSON</Divider>
          <Form.Item name="advancedJson">
            <Input.TextArea
              rows={6}
              spellCheck={false}
              placeholder={'{"hnsw_config":{"m":16},"optimizers_config":{"default_segment_number":2}}'}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};
