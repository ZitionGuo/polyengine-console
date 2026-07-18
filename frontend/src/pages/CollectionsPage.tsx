import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  AutoComplete,
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
  Progress,
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
  Upload,
  type UploadFile,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  BarChart3,
  Camera,
  CircleCheckBig,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  Download,
  Gauge,
  Eye,
  Filter,
  Plus,
  Pencil,
  RefreshCw,
  Search,
  Settings,
  Waypoints,
  Trash2,
  Upload as UploadIcon,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { JsonView } from "../components/JsonView";
import { PageToolbar } from "../components/PageToolbar";
import {
  api,
  type AliasSummary,
  type CollectionOverview,
  type CollectionSnapshot,
  type OptimizationItem,
  type SnapshotRestoreOptions,
} from "../services/api";
import {
  buildCollectionCreatePayload,
  buildIndexSchema,
  type CollectionFormValues,
  type IndexInput,
  type PayloadIndexType,
} from "../services/collectionPayload";
import {
  buildRetryableIndexFailures,
  parseRetryIndexSchema,
  type RetryableIndexFailure,
} from "../services/collectionCreateResult";
import {
  buildCollectionUpdatePayload,
  type CollectionUpdateFormValues,
} from "../services/collectionUpdate";
import {
  describeCollectionOverviewError,
  filterCollectionOverview,
  formatCollectionMetric,
  getCollectionHealth,
  type CollectionHealthFilter,
} from "../services/collectionOverview";
import {
  buildPointRetrievePayload,
  buildPointScrollPayload,
  buildPointQueryPayload,
  buildPointCountPayload,
  buildPointFacetPayload,
  defaultPointFilterJson,
  defaultPointIdsJson,
  defaultPointQueryJson,
  defaultPointsJson,
  hasPointFilter,
  normalizePointFilterJson,
  parsePointPayloadInput,
  parseUpsertPointsInput,
} from "../services/points";
import {
  buildSnapshotRestoreOptions,
  type SnapshotRestoreValues,
} from "../services/snapshotRestore";
import {
  getCollectionNameFromPath,
  getCollectionPath,
  getPageDocumentTitle,
} from "../services/navigation";

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

interface FacetRow {
  key: string;
  value: unknown;
  count: number;
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
  onEditSettings: () => void;
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
  onEditSettings,
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

      <section>
        <div className="section-heading">
          <Typography.Title level={4}>Configuration</Typography.Title>
          <Button icon={<Settings size={16} />} onClick={onEditSettings}>
            Edit settings
          </Button>
        </div>
        <Descriptions
          bordered
          size="small"
          column={{ xs: 1, sm: 2 }}
          items={[
            { key: "optimizer", label: "Optimizer", children: displayValue(details.optimizer_status) },
            { key: "shards", label: "Shards", children: displayValue(params.shard_number) },
            { key: "replicas", label: "Replicas", children: displayValue(params.replication_factor) },
            { key: "write", label: "Write consistency", children: displayValue(params.write_consistency_factor) },
            { key: "payload", label: "On-disk payload", children: displayValue(params.on_disk_payload) },
            { key: "queue", label: "Update queue", children: displayValue(asRecord(details.update_queue).length) },
          ]}
        />
      </section>

      <CollectionOptimizationsPanel collectionName={collectionName} />

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

      <CollectionSnapshots collectionName={collectionName} />

      <CollectionPointsPreview
        collectionName={collectionName}
        vectorOptions={denseVectorOptions}
        payloadFields={payloadRows.map((row) => row.field)}
      />

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
                column={{ xs: 1, sm: 2 }}
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

interface OptimizationRow extends OptimizationItem {
  key: string;
  state: "running" | "queued" | "completed";
}

const CollectionOptimizationsPanel = ({ collectionName }: { collectionName: string }) => {
  const optimizationsQuery = useQuery({
    queryKey: ["collections", collectionName, "optimizations"],
    queryFn: () => api.getCollectionOptimizations(collectionName),
    refetchInterval: (query) => {
      const result = query.state.data?.result;
      const activeCount =
        (result?.running?.length ?? 0) + (result?.summary?.queued_optimizations ?? 0);
      return activeCount > 0 ? 3_000 : false;
    },
  });
  const result = optimizationsQuery.data?.result;
  const summary = result?.summary;
  const buildRows = (
    items: OptimizationItem[] | undefined,
    state: OptimizationRow["state"],
  ): OptimizationRow[] =>
    (items ?? []).map((item, index) => ({
      ...item,
      key: item.uuid ?? `${state}-${index}`,
      state,
    }));
  const activeRows = [
    ...buildRows(result?.running, "running"),
    ...buildRows(result?.queued, "queued"),
  ];
  const completedRows = buildRows(result?.completed, "completed");
  const columns: ColumnsType<OptimizationRow> = [
    {
      title: "Optimizer",
      dataIndex: "optimizer",
      width: 170,
      render: (value: string | undefined, row) =>
        value ?? row.progress?.name ?? "Qdrant optimizer",
    },
    {
      title: "State",
      dataIndex: "state",
      width: 100,
      render: (value: OptimizationRow["state"], row) => (
        <Tag color={value === "running" ? "blue" : value === "queued" ? "orange" : "green"}>
          {row.status ?? value}
        </Tag>
      ),
    },
    {
      title: "Segments",
      width: 90,
      render: (_, row) => row.segments?.length ?? 0,
    },
    {
      title: "Points",
      width: 100,
      render: (_, row) =>
        (row.segments ?? []).reduce((total, segment) => total + (segment.points_count ?? 0), 0),
    },
    {
      title: "Progress",
      width: 170,
      render: (_, row) => {
        const done = row.progress?.done;
        const total = row.progress?.total;
        if (typeof done !== "number" || typeof total !== "number" || total <= 0) {
          return row.state === "completed" ? "Complete" : "Waiting";
        }
        return (
          <Progress
            percent={Math.min(100, Math.round((done / total) * 100))}
            size="small"
            status={row.state === "completed" ? "success" : "active"}
          />
        );
      },
    },
  ];

  return (
    <section>
      <div className="section-heading">
        <Typography.Title level={4}>Optimization activity</Typography.Title>
        <Tooltip title="Refresh optimization progress">
          <Button
            icon={<RefreshCw size={16} />}
            loading={optimizationsQuery.isFetching}
            onClick={() => optimizationsQuery.refetch()}
          />
        </Tooltip>
      </div>
      {optimizationsQuery.isError ? (
        <Alert
          type="warning"
          showIcon
          message="Unable to load optimization progress"
          description={
            optimizationsQuery.error instanceof Error
              ? optimizationsQuery.error.message
              : undefined
          }
        />
      ) : (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Descriptions
            bordered
            size="small"
            column={{ xs: 2, sm: 4 }}
            items={[
              {
                key: "running",
                label: "Running",
                children: result?.running?.length ?? 0,
              },
              {
                key: "queued",
                label: "Queued",
                children: summary?.queued_optimizations ?? 0,
              },
              {
                key: "queued-points",
                label: "Queued points",
                children: summary?.queued_points ?? 0,
              },
              {
                key: "idle",
                label: "Idle segments",
                children: summary?.idle_segments ?? result?.idle_segments?.length ?? 0,
              },
            ]}
          />
          {activeRows.length ? (
            <Table
              rowKey="key"
              size="small"
              columns={columns}
              dataSource={activeRows}
              pagination={false}
              scroll={{ x: 630 }}
            />
          ) : !optimizationsQuery.isLoading ? (
            <Alert
              type="success"
              showIcon
              message="Optimization queue is idle"
              description="Qdrant is not currently merging, indexing, or rebuilding collection segments."
            />
          ) : null}
          {completedRows.length ? (
            <Collapse
              size="small"
              items={[
                {
                  key: "completed",
                  label: `Recent completed optimizations (${completedRows.length})`,
                  children: (
                    <Table
                      rowKey="key"
                      size="small"
                      columns={columns}
                      dataSource={completedRows}
                      pagination={false}
                      scroll={{ x: 630 }}
                    />
                  ),
                },
              ]}
            />
          ) : null}
        </Space>
      )}
    </section>
  );
};

const formatBytes = (size: number) => {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / 1024 ** unitIndex;
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const CollectionSnapshots = ({ collectionName }: { collectionName: string }) => {
  const { message, modal } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreFiles, setRestoreFiles] = useState<UploadFile[]>([]);
  const [restoreForm] = Form.useForm<SnapshotRestoreValues>();
  const snapshotsQuery = useQuery({
    queryKey: ["collections", collectionName, "snapshots"],
    queryFn: () => api.listCollectionSnapshots(collectionName),
  });
  const createSnapshotMutation = useMutation({
    mutationFn: () => api.createCollectionSnapshot(collectionName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections", collectionName, "snapshots"] });
      message.success("Snapshot created.");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "Failed to create snapshot.");
    },
  });
  const deleteSnapshotMutation = useMutation({
    mutationFn: (snapshotName: string) =>
      api.deleteCollectionSnapshot(collectionName, snapshotName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections", collectionName, "snapshots"] });
      message.success("Snapshot deleted.");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "Failed to delete snapshot.");
    },
  });
  const restoreSnapshotMutation = useMutation({
    mutationFn: ({
      snapshot,
      options,
    }: {
      snapshot: File;
      options: SnapshotRestoreOptions;
    }) => api.uploadCollectionSnapshot(collectionName, snapshot, options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections", "overview"] });
      queryClient.invalidateQueries({ queryKey: ["collections", collectionName] });
      setRestoreOpen(false);
      setRestoreFiles([]);
      restoreForm.resetFields();
      message.success("Snapshot restored.");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "Failed to restore snapshot.");
    },
  });
  const snapshots = snapshotsQuery.data?.result ?? [];
  const openRestore = () => {
    setRestoreFiles([]);
    restoreForm.setFieldsValue({
      priority: "snapshot",
      checksum: "",
      confirmation: "",
    });
    setRestoreOpen(true);
  };
  const closeRestore = () => {
    if (restoreSnapshotMutation.isPending) return;
    setRestoreOpen(false);
    setRestoreFiles([]);
    restoreForm.resetFields();
  };
  const submitRestore = (values: SnapshotRestoreValues) => {
    const snapshot = restoreFiles[0]?.originFileObj;
    if (!snapshot) {
      message.error("Choose a snapshot file to restore.");
      return;
    }
    try {
      restoreSnapshotMutation.mutate({
        snapshot,
        options: buildSnapshotRestoreOptions(collectionName, values),
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Invalid restore options.");
    }
  };
  const columns: ColumnsType<CollectionSnapshot> = [
    {
      title: "Snapshot",
      dataIndex: "name",
      render: (name: string, snapshot) => (
        <Space direction="vertical" size={0} className="snapshot-name">
          <Typography.Text strong ellipsis={{ tooltip: name }}>
            {name}
          </Typography.Text>
          {snapshot.checksum ? (
            <Typography.Text type="secondary" ellipsis={{ tooltip: snapshot.checksum }}>
              {snapshot.checksum}
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: "Created",
      dataIndex: "creation_time",
      width: 190,
      render: (value: string) => (value ? new Date(value).toLocaleString() : "-"),
    },
    {
      title: "Size",
      dataIndex: "size",
      width: 100,
      render: (value: number) => formatBytes(value),
    },
    {
      title: "Actions",
      width: 116,
      align: "right",
      render: (_, snapshot) => (
        <Space size={6}>
          <Tooltip title="Download snapshot">
            <Button
              aria-label={`Download snapshot ${snapshot.name}`}
              icon={<Download size={16} />}
              href={api.collectionSnapshotDownloadUrl(collectionName, snapshot.name)}
              download={snapshot.name}
            />
          </Tooltip>
          <Tooltip title="Delete snapshot">
            <Button
              danger
              aria-label={`Delete snapshot ${snapshot.name}`}
              icon={<Trash2 size={16} />}
              loading={
                deleteSnapshotMutation.isPending &&
                deleteSnapshotMutation.variables === snapshot.name
              }
              onClick={() =>
                modal.confirm({
                  title: `Delete snapshot ${snapshot.name}?`,
                  content: "This removes the snapshot file from Qdrant storage.",
                  okText: "Delete",
                  okButtonProps: { danger: true },
                  onOk: () => deleteSnapshotMutation.mutateAsync(snapshot.name),
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
      <section>
        <div className="section-heading">
          <Typography.Title level={4}>Snapshots</Typography.Title>
          <Space wrap>
            <Tooltip title="Refresh snapshots">
              <Button
                icon={<RefreshCw size={16} />}
                loading={snapshotsQuery.isFetching}
                onClick={() => snapshotsQuery.refetch()}
              />
            </Tooltip>
            <Button icon={<UploadIcon size={16} />} onClick={openRestore}>
              Restore
            </Button>
            <Button
              icon={<Camera size={16} />}
              loading={createSnapshotMutation.isPending}
              onClick={() => createSnapshotMutation.mutate()}
            >
              Create snapshot
            </Button>
          </Space>
        </div>
        {snapshotsQuery.isError ? (
          <Alert
            type="warning"
            showIcon
            message="Unable to load snapshots"
            description={
              snapshotsQuery.error instanceof Error ? snapshotsQuery.error.message : undefined
            }
            style={{ marginBottom: 12 }}
          />
        ) : null}
        <Table
          rowKey="name"
          size="small"
          columns={columns}
          dataSource={snapshots}
          loading={snapshotsQuery.isLoading}
          pagination={false}
          scroll={{ x: 620 }}
          locale={{ emptyText: snapshotsQuery.isError ? "Snapshots unavailable" : "No snapshots yet" }}
        />
      </section>

      <Modal
        className="snapshot-restore-modal"
        title={`Restore snapshot into ${collectionName}`}
        open={restoreOpen}
        width={620}
        okText="Restore snapshot"
        okButtonProps={{ danger: true, disabled: !restoreFiles.length }}
        confirmLoading={restoreSnapshotMutation.isPending}
        closable={!restoreSnapshotMutation.isPending}
        maskClosable={false}
        onOk={() => restoreForm.submit()}
        onCancel={closeRestore}
      >
        <Alert
          type="error"
          showIcon
          message="Restoring can overwrite collection data and configuration."
          description="Aliases are not included in collection snapshots and will not be restored."
          style={{ marginBottom: 16 }}
        />
        <Form form={restoreForm} layout="vertical" onFinish={submitRestore}>
          <Form.Item label="Snapshot file" required>
            <Upload.Dragger
              accept=".snapshot"
              maxCount={1}
              fileList={restoreFiles}
              beforeUpload={(file) => {
                if (!file.name.toLowerCase().endsWith(".snapshot")) {
                  message.error("Snapshot files must use the .snapshot extension.");
                  return Upload.LIST_IGNORE;
                }
                setRestoreFiles([
                  {
                    uid: file.uid,
                    name: file.name,
                    status: "done",
                    size: file.size,
                    type: file.type,
                    originFileObj: file,
                  },
                ]);
                return false;
              }}
              onRemove={() => {
                setRestoreFiles([]);
                return true;
              }}
            >
              <div className="snapshot-upload-prompt">
                <UploadIcon size={24} />
                <Typography.Text strong>Snapshot file</Typography.Text>
                <Typography.Text type="secondary">.snapshot</Typography.Text>
              </div>
            </Upload.Dragger>
          </Form.Item>
          <Form.Item label="Recovery priority" name="priority" required>
            <Select
              options={[
                { value: "snapshot", label: "Snapshot - prefer uploaded data" },
                { value: "replica", label: "Replica - prefer existing data" },
                { value: "no_sync", label: "No sync - advanced" },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="SHA-256 checksum"
            name="checksum"
            rules={[
              {
                pattern: /^[A-Fa-f0-9]{64}$/,
                message: "Checksum must be a 64-character SHA-256 value.",
              },
            ]}
          >
            <Input allowClear placeholder="Optional" spellCheck={false} />
          </Form.Item>
          <Form.Item
            label={`Type ${collectionName} to confirm`}
            name="confirmation"
            validateTrigger="onBlur"
            rules={[
              { required: true, message: "Collection name confirmation is required." },
              {
                validator: (_, value) =>
                  value === collectionName
                    ? Promise.resolve()
                    : Promise.reject(new Error(`Type ${collectionName} exactly.`)),
              },
            ]}
          >
            <Input autoComplete="off" spellCheck={false} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

const CollectionPointsPreview = ({
  collectionName,
  vectorOptions,
  payloadFields,
}: {
  collectionName: string;
  vectorOptions: VectorOption[];
  payloadFields: string[];
}) => {
  const { message, modal } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState<unknown>(undefined);
  const [offsetHistory, setOffsetHistory] = useState<unknown[]>([]);
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
  const [facetOpen, setFacetOpen] = useState(false);
  const [facetKey, setFacetKey] = useState("");
  const [facetLimit, setFacetLimit] = useState(10);
  const [facetExact, setFacetExact] = useState(false);
  const [payloadPoint, setPayloadPoint] = useState<PointRow | null>(null);
  const [payloadJson, setPayloadJson] = useState("{}");
  const filterActive = hasPointFilter(activeFilterJson);
  const resetPagination = () => {
    setOffset(undefined);
    setOffsetHistory([]);
  };
  const invalidatePointData = () => {
    queryClient.invalidateQueries({ queryKey: ["collections", collectionName, "points"] });
    queryClient.invalidateQueries({ queryKey: ["collections", collectionName] });
  };
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
  const countQuery = useQuery({
    queryKey: [
      "collections",
      collectionName,
      "points",
      "count",
      activeFilterJson,
    ],
    queryFn: () =>
      api.countPoints(
        collectionName,
        buildPointCountPayload({ filterText: activeFilterJson, exact: true }),
      ),
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
      invalidatePointData();
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
      resetPagination();
      invalidatePointData();
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

  const facetPointsMutation = useMutation({
    mutationFn: () =>
      api.facetPoints(
        collectionName,
        buildPointFacetPayload({
          key: facetKey,
          limit: facetLimit,
          filterText: activeFilterJson,
          exact: facetExact,
        }),
      ),
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "Failed to load payload facets.");
    },
  });

  const overwritePayloadMutation = useMutation({
    mutationFn: async () => {
      if (!payloadPoint) throw new Error("Point is required.");
      return api.overwritePointPayload(collectionName, {
        pointId: payloadPoint.pointId,
        payload: parsePointPayloadInput(payloadJson),
        wait: true,
      });
    },
    onSuccess: () => {
      setPayloadPoint(null);
      invalidatePointData();
      message.success("Point payload replaced.");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "Failed to replace point payload.");
    },
  });

  const clearPayloadMutation = useMutation({
    mutationFn: async () => {
      if (!payloadPoint) throw new Error("Point is required.");
      return api.clearPointPayload(collectionName, {
        pointId: payloadPoint.pointId,
        wait: true,
      });
    },
    onSuccess: () => {
      setPayloadPoint(null);
      invalidatePointData();
      message.success("Point payload cleared.");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "Failed to clear point payload.");
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

  const openPayloadEditor = (row: PointRow) => {
    const payload = asRecord(asRecord(row.raw).payload);
    setPayloadJson(JSON.stringify(payload, null, 2));
    setPayloadPoint(row);
  };

  const confirmClearPayload = () => {
    if (!payloadPoint) return;
    modal.confirm({
      title: `Clear payload for point ${payloadPoint.id}?`,
      content: "The point and its vectors remain; only its payload fields are removed.",
      okText: "Clear payload",
      okButtonProps: { danger: true },
      onOk: () => clearPayloadMutation.mutateAsync(),
    });
  };

  const applyScrollFilter = () => {
    try {
      const normalized = normalizePointFilterJson(filterDraftJson);
      setActiveFilterJson(normalized);
      setFilterDraftJson(normalized);
      resetPagination();
      setFilterOpen(false);
      facetPointsMutation.reset();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Invalid filter JSON.");
    }
  };

  const clearScrollFilter = () => {
    setActiveFilterJson(defaultPointFilterJson);
    setFilterDraftJson(defaultPointFilterJson);
    resetPagination();
    facetPointsMutation.reset();
  };

  const openFacetExplorer = () => {
    setFacetKey(payloadFields[0] ?? "");
    setFacetLimit(10);
    setFacetExact(false);
    facetPointsMutation.reset();
    setFacetOpen(true);
  };

  const goToPreviousPage = () => {
    const previousOffset = offsetHistory[offsetHistory.length - 1];
    setOffsetHistory((current) => current.slice(0, -1));
    setOffset(previousOffset);
  };

  const goToNextPage = () => {
    setOffsetHistory((current) => [...current, offset]);
    setOffset(nextOffset);
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
      width: 132,
      align: "right",
      render: (_, row) => (
        <Space size={6}>
          <Tooltip title="Edit payload">
            <Button
              aria-label={`Edit payload for point ${row.id}`}
              icon={<Pencil size={16} />}
              onClick={() => openPayloadEditor(row)}
            />
          </Tooltip>
          <Tooltip title="Delete point">
            <Button
              danger
              aria-label={`Delete point ${row.id}`}
              icon={<Trash2 size={16} />}
              loading={deletePointMutation.isPending && deletePointMutation.variables === row.pointId}
              onClick={() => confirmDeletePoint(row)}
            />
          </Tooltip>
        </Space>
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
  const countResult = unwrapResult(countQuery.data);
  const pointCount = typeof countResult.count === "number" ? countResult.count : null;
  const facetResult = unwrapResult(facetPointsMutation.data);
  const facetRows: FacetRow[] = (
    Array.isArray(facetResult.hits) ? facetResult.hits : []
  ).map((hit, index) => {
    const item = asRecord(hit);
    return {
      key: `${index}-${summarizeJson(item.value, "null")}`,
      value: item.value,
      count: asNumber(item.count),
    };
  });
  const facetColumns: ColumnsType<FacetRow> = [
    {
      title: "Value",
      dataIndex: "value",
      render: (value: unknown) => (
        <Typography.Text code className="truncate-cell" title={summarizeJson(value, "null")}>
          {summarizeJson(value, "null")}
        </Typography.Text>
      ),
    },
    {
      title: "Points",
      dataIndex: "count",
      width: 120,
      align: "right",
      sorter: (left, right) => left.count - right.count,
      render: (count: number) => count.toLocaleString(),
    },
  ];

  return (
    <section>
      <div className="section-heading">
        <Space wrap>
          <Typography.Title level={4}>Points preview</Typography.Title>
          <Tooltip
            title={
              countQuery.isError
                ? countQuery.error instanceof Error
                  ? countQuery.error.message
                  : "Unable to count matching points."
                : filterActive
                  ? "Exact count for the active filter."
                  : "Exact collection point count."
            }
          >
            <Tag color={countQuery.isError ? "red" : filterActive ? "blue" : undefined}>
              {countQuery.isFetching
                ? "Counting..."
                : countQuery.isError
                  ? "Count unavailable"
                  : `${(pointCount ?? 0).toLocaleString()} ${filterActive ? "matching" : "total"}`}
            </Tag>
          </Tooltip>
        </Space>
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
          <Button icon={<BarChart3 size={16} />} onClick={openFacetExplorer}>
            Facets
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
              resetPagination();
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
        scroll={{ x: 760 }}
        expandable={{
          expandedRowRender: (row) => <JsonView data={row.raw} minHeight={140} />,
        }}
        locale={{ emptyText: pointsQuery.isError ? "Unable to load points" : "No points returned" }}
      />
      <div className="table-footer-actions">
        <Tooltip title="First page">
          <Button
            aria-label="First page"
            icon={<ChevronsLeft size={16} />}
            disabled={!offsetHistory.length}
            onClick={resetPagination}
          />
        </Tooltip>
        <Tooltip title="Previous page">
          <Button
            aria-label="Previous page"
            icon={<ChevronLeft size={16} />}
            disabled={!offsetHistory.length}
            onClick={goToPreviousPage}
          />
        </Tooltip>
        <Tooltip title="Next page">
          <Button
            type="primary"
            aria-label="Next page"
            icon={<ChevronRight size={16} />}
            disabled={nextOffset === undefined || nextOffset === null}
            onClick={goToNextPage}
          />
        </Tooltip>
      </div>
      <Modal
        title={`Edit payload for point ${payloadPoint?.id ?? ""}`}
        open={Boolean(payloadPoint)}
        okText="Replace payload"
        width={700}
        confirmLoading={overwritePayloadMutation.isPending}
        onOk={() => overwritePayloadMutation.mutate()}
        onCancel={() => setPayloadPoint(null)}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="This replaces the entire payload; the point ID and vectors stay unchanged."
          />
          <Input.TextArea
            value={payloadJson}
            rows={12}
            spellCheck={false}
            onChange={(event) => setPayloadJson(event.target.value)}
          />
          <div className="modal-danger-action">
            <Button
              danger
              icon={<Trash2 size={16} />}
              loading={clearPayloadMutation.isPending}
              onClick={confirmClearPayload}
            >
              Clear payload
            </Button>
          </div>
        </Space>
      </Modal>
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
        title={`Payload facets in ${collectionName}`}
        open={facetOpen}
        okText="Run facet"
        width={720}
        confirmLoading={facetPointsMutation.isPending}
        onOk={() => facetPointsMutation.mutate()}
        onCancel={() => setFacetOpen(false)}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type={payloadFields.length ? "info" : "warning"}
            showIcon
            message={
              payloadFields.length
                ? "Facet suggestions come from this collection's payload indexes."
                : "No payload indexes are reported for this collection."
            }
            description="Qdrant facet queries normally require a matching payload index. The active point filter is applied automatically."
          />
          <div className="form-grid two">
            <div>
              <Typography.Text strong>Payload field</Typography.Text>
              <AutoComplete
                allowClear
                value={facetKey}
                options={payloadFields.map((field) => ({ value: field }))}
                placeholder="category"
                style={{ width: "100%", marginTop: 6 }}
                onChange={setFacetKey}
                filterOption={(input, option) =>
                  String(option?.value ?? "").toLowerCase().includes(input.toLowerCase())
                }
              />
            </div>
            <div className="form-grid two">
              <div>
                <Typography.Text strong>Top values</Typography.Text>
                <InputNumber
                  min={1}
                  max={100}
                  precision={0}
                  value={facetLimit}
                  style={{ width: "100%", marginTop: 6 }}
                  onChange={(value) => setFacetLimit(value ?? 10)}
                />
              </div>
              <div>
                <Typography.Text strong>Exact counts</Typography.Text>
                <div style={{ marginTop: 10 }}>
                  <Switch checked={facetExact} onChange={setFacetExact} />
                </div>
              </div>
            </div>
          </div>
          {facetPointsMutation.isError ? (
            <Alert
              type="error"
              showIcon
              message="Unable to load facets"
              description={
                facetPointsMutation.error instanceof Error
                  ? facetPointsMutation.error.message
                  : undefined
              }
            />
          ) : null}
          {facetPointsMutation.data ? (
            <Table
              rowKey="key"
              size="small"
              columns={facetColumns}
              dataSource={facetRows}
              loading={facetPointsMutation.isPending}
              pagination={false}
              scroll={{ x: 460 }}
              locale={{ emptyText: "No facet values found" }}
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [indexFailuresOpen, setIndexFailuresOpen] = useState(false);
  const [indexFailures, setIndexFailures] = useState<RetryableIndexFailure[]>([]);
  const [retryFailure, setRetryFailure] = useState<RetryableIndexFailure | null>(null);
  const [retryFieldName, setRetryFieldName] = useState("");
  const [retrySchemaJson, setRetrySchemaJson] = useState("");
  const [selectedCollection, setSelectedCollection] = useState<string | null>(() =>
    getCollectionNameFromPath(window.location.pathname),
  );
  const [collectionSearch, setCollectionSearch] = useState("");
  const [collectionHealthFilter, setCollectionHealthFilter] =
    useState<CollectionHealthFilter>("all");
  const [form] = Form.useForm<CollectionFormValues>();
  const [indexForm] = Form.useForm<IndexInput>();
  const [aliasForm] = Form.useForm<{ aliasName: string }>();
  const [settingsForm] = Form.useForm<CollectionUpdateFormValues>();
  const vectorMode = Form.useWatch("vectorMode", form) ?? "single";
  const indexType = Form.useWatch("type", indexForm);

  useEffect(() => {
    const syncCollectionFromLocation = () => {
      setSelectedCollection(getCollectionNameFromPath(window.location.pathname));
    };

    window.addEventListener("popstate", syncCollectionFromLocation);
    return () => window.removeEventListener("popstate", syncCollectionFromLocation);
  }, []);

  useEffect(() => {
    document.title = selectedCollection
      ? `${selectedCollection} · Collections · Qdrant Local Admin`
      : getPageDocumentTitle("collections");
  }, [selectedCollection]);

  const openCollectionDetails = (collectionName: string) => {
    const path = getCollectionPath(collectionName);
    if (window.location.pathname !== path) {
      window.history.pushState({ page: "collections", collectionName }, "", path);
    }
    setSelectedCollection(collectionName);
  };

  const closeCollectionDetails = () => {
    if (window.location.pathname !== "/collections") {
      window.history.replaceState({ page: "collections" }, "", "/collections");
    }
    setSelectedCollection(null);
  };

  const collectionsOverviewQuery = useQuery({
    queryKey: ["collections", "overview"],
    queryFn: api.listCollectionOverview,
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
      return { name, result: await api.createCollection(name, body) };
    },
    onSuccess: ({ name, result }) => {
      setCreateOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      if (result.index_errors.length) {
        const failures = buildRetryableIndexFailures(name, result.index_errors);
        setIndexFailures((current) => [
          ...current.filter((failure) => failure.collectionName !== name),
          ...failures,
        ]);
        setIndexFailuresOpen(true);
        message.warning("Collection created, but one or more payload indexes failed.");
        return;
      }
      setIndexFailures((current) =>
        current.filter((failure) => failure.collectionName !== name),
      );
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
      closeCollectionDetails();
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

  const retryIndexMutation = useMutation({
    mutationFn: async ({
      failure,
      fieldName,
      fieldSchema,
    }: {
      failure: RetryableIndexFailure;
      fieldName: string;
      fieldSchema: unknown;
    }) => api.createIndex(failure.collectionName, fieldName, fieldSchema),
    onSuccess: (_, variables) => {
      setIndexFailures((current) =>
        current.filter((failure) => failure.key !== variables.failure.key),
      );
      queryClient.invalidateQueries({
        queryKey: ["collections", variables.failure.collectionName],
      });
      setRetryFailure(null);
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

  const updateCollectionMutation = useMutation({
    mutationFn: async (values: CollectionUpdateFormValues) => {
      if (!selectedCollection) {
        throw new Error("Collection is required.");
      }
      return api.updateCollection(
        selectedCollection,
        buildCollectionUpdatePayload(values),
      );
    },
    onSuccess: () => {
      if (selectedCollection) {
        queryClient.invalidateQueries({ queryKey: ["collections", selectedCollection] });
      }
      setSettingsOpen(false);
      message.success("Collection settings updated.");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "Failed to update collection settings.");
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

  const openSettingsModal = () => {
    const details = unwrapResult(detailsQuery.data);
    const config = asRecord(details.config);
    const params = asRecord(config.params);
    const optimizer = asRecord(config.optimizer_config);
    const hnsw = asRecord(config.hnsw_config);
    settingsForm.setFieldsValue({
      replicationFactor:
        typeof params.replication_factor === "number" ? params.replication_factor : undefined,
      writeConsistencyFactor:
        typeof params.write_consistency_factor === "number"
          ? params.write_consistency_factor
          : undefined,
      onDiskPayload:
        typeof params.on_disk_payload === "boolean" ? params.on_disk_payload : undefined,
      indexingThreshold:
        typeof optimizer.indexing_threshold === "number"
          ? optimizer.indexing_threshold
          : undefined,
      flushIntervalSec:
        typeof optimizer.flush_interval_sec === "number"
          ? optimizer.flush_interval_sec
          : undefined,
      hnswM: typeof hnsw.m === "number" ? hnsw.m : undefined,
      hnswEfConstruct:
        typeof hnsw.ef_construct === "number" ? hnsw.ef_construct : undefined,
      advancedJson: "",
    });
    setSettingsOpen(true);
  };

  const openRetryIndexModal = (failure: RetryableIndexFailure) => {
    setRetryFieldName(failure.fieldName);
    setRetrySchemaJson(JSON.stringify(failure.fieldSchema, null, 2) ?? "");
    setRetryFailure(failure);
  };

  const submitRetryIndex = () => {
    if (!retryFailure) return;
    const fieldName = retryFieldName.trim();
    if (!fieldName) {
      message.error("Field name is required.");
      return;
    }

    try {
      retryIndexMutation.mutate({
        failure: retryFailure,
        fieldName,
        fieldSchema: parseRetryIndexSchema(retrySchemaJson),
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Invalid index schema JSON.");
    }
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

  const allCollections = collectionsOverviewQuery.data?.result?.collections ?? [];
  const collections = filterCollectionOverview(
    allCollections,
    collectionSearch,
    collectionHealthFilter,
  );
  const overviewErrors = collectionsOverviewQuery.data?.result?.errors ?? [];
  const healthyCollectionCount = allCollections.filter(
    (collection) => getCollectionHealth(collection).health === "healthy",
  ).length;
  const totalPointCount = allCollections.reduce(
    (total, collection) => total + (collection.points_count ?? 0),
    0,
  );
  const totalIndexedVectorCount = allCollections.reduce(
    (total, collection) => total + (collection.indexed_vectors_count ?? 0),
    0,
  );
  const indexedCoverage = totalPointCount
    ? Math.min(100, Math.round((totalIndexedVectorCount / totalPointCount) * 100))
    : 0;
  const collectionAliases =
    aliasesQuery.data?.result?.aliases.filter((alias) => alias.collection_name === selectedCollection) ?? [];

  const columns: ColumnsType<CollectionOverview> = [
    {
      title: "Collection",
      dataIndex: "name",
      width: 225,
      render: (name: string) => (
        <Tooltip title={name}>
          <Typography.Link
            strong
            ellipsis
            className="collection-name-cell"
            href={getCollectionPath(name)}
            onClick={(event) => {
              event.preventDefault();
              openCollectionDetails(name);
            }}
          >
            {name}
          </Typography.Link>
        </Tooltip>
      ),
    },
    {
      title: "Status",
      width: 125,
      render: (_, collection) => {
        const health = getCollectionHealth(collection);
        return (
          <Tooltip
            title={
              collection.error
                ? describeCollectionOverviewError(collection)
                : `Qdrant status: ${collection.status ?? "unknown"}`
            }
          >
            <Space size={4}>
              <Tag color={health.color}>{health.label}</Tag>
              {typeof collection.update_queue_length === "number" &&
              collection.update_queue_length > 0 ? (
                <Tag>{collection.update_queue_length} queued</Tag>
              ) : null}
            </Space>
          </Tooltip>
        );
      },
    },
    {
      title: "Points",
      dataIndex: "points_count",
      width: 85,
      align: "right",
      sorter: (left, right) => (left.points_count ?? -1) - (right.points_count ?? -1),
      render: formatCollectionMetric,
    },
    {
      title: "Indexed",
      dataIndex: "indexed_vectors_count",
      width: 90,
      align: "right",
      sorter: (left, right) =>
        (left.indexed_vectors_count ?? -1) - (right.indexed_vectors_count ?? -1),
      render: formatCollectionMetric,
    },
    {
      title: "Segments",
      dataIndex: "segments_count",
      width: 85,
      align: "right",
      sorter: (left, right) => (left.segments_count ?? -1) - (right.segments_count ?? -1),
      render: formatCollectionMetric,
    },
    {
      title: "Vector spaces",
      width: 150,
      render: (_, collection) => (
        <Space size={4} wrap>
          <Tag>{formatCollectionMetric(collection.dense_vector_count)} dense</Tag>
          <Tag color="cyan">{formatCollectionMetric(collection.sparse_vector_count)} sparse</Tag>
        </Space>
      ),
    },
    {
      title: "Actions",
      width: 105,
      align: "right",
      render: (_, record) => (
        <Space>
          <Tooltip title="View details">
            <Button
              aria-label={`View ${record.name}`}
              icon={<Eye size={16} />}
              onClick={() => openCollectionDetails(record.name)}
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

  const indexFailureColumns: ColumnsType<RetryableIndexFailure> = [
    {
      title: "Collection",
      dataIndex: "collectionName",
      width: 190,
      ellipsis: true,
    },
    {
      title: "Field",
      dataIndex: "fieldName",
      width: 180,
      ellipsis: true,
    },
    {
      title: "Schema",
      dataIndex: "fieldSchema",
      width: 190,
      render: (schema: unknown) => (
        <Typography.Text code ellipsis style={{ maxWidth: 170 }}>
          {summarizeJson(schema)}
        </Typography.Text>
      ),
    },
    {
      title: "Status",
      dataIndex: "statusCode",
      width: 90,
      render: (statusCode?: number | null) => <Tag color="red">{statusCode ?? "failed"}</Tag>,
    },
    {
      title: "Error",
      dataIndex: "message",
      render: (errorMessage: string) => (
        <Tooltip title={errorMessage}>
          <Typography.Text ellipsis style={{ display: "block", maxWidth: 260 }}>
            {errorMessage}
          </Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: "Actions",
      width: 130,
      align: "right",
      render: (_, failure) => (
        <Button
          icon={<Pencil size={15} />}
          onClick={() => openRetryIndexModal(failure)}
        >
          Edit & retry
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageToolbar
        title="Collections"
        subtitle="Create, inspect, tune, back up, and remove local Qdrant collections."
        actions={
          <>
            <Tooltip title="Refresh">
              <Button
                icon={<RefreshCw size={16} />}
                onClick={() => collectionsOverviewQuery.refetch()}
                loading={collectionsOverviewQuery.isFetching}
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

      {collectionsOverviewQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message="Unable to load collections"
          description={
            collectionsOverviewQuery.error instanceof Error
              ? collectionsOverviewQuery.error.message
              : undefined
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {overviewErrors.length ? (
        <Alert
          type="warning"
          showIcon
          message={`${overviewErrors.length} collection ${overviewErrors.length === 1 ? "detail is" : "details are"} unavailable`}
          description="The remaining collection metrics loaded normally. Refresh to retry the unavailable rows."
          action={<Button onClick={() => collectionsOverviewQuery.refetch()}>Retry</Button>}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {indexFailures.length ? (
        <Alert
          type="warning"
          showIcon
          message={`${indexFailures.length} payload ${indexFailures.length === 1 ? "index needs" : "indexes need"} attention`}
          description="The collections were created and kept. Review the failed index definitions, edit them if needed, and retry without recreating collection data."
          action={
            <Button onClick={() => setIndexFailuresOpen(true)}>
              Review & retry
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <section className="collection-summary" aria-label="Collection summary">
        <div className="summary-metric">
          <span className="summary-icon summary-icon-coral"><Waypoints size={18} /></span>
          <div>
            <Typography.Text type="secondary">Collections</Typography.Text>
            <Typography.Title level={3}>{formatCollectionMetric(allCollections.length)}</Typography.Title>
          </div>
        </div>
        <div className="summary-metric">
          <span className="summary-icon summary-icon-green"><CircleCheckBig size={18} /></span>
          <div>
            <Typography.Text type="secondary">Healthy</Typography.Text>
            <Typography.Title level={3}>{formatCollectionMetric(healthyCollectionCount)}</Typography.Title>
          </div>
        </div>
        <div className="summary-metric">
          <span className="summary-icon summary-icon-blue"><BarChart3 size={18} /></span>
          <div>
            <Typography.Text type="secondary">Total points</Typography.Text>
            <Typography.Title level={3}>{formatCollectionMetric(totalPointCount)}</Typography.Title>
          </div>
        </div>
        <div className="summary-metric">
          <span className="summary-icon summary-icon-amber"><Gauge size={18} /></span>
          <div>
            <Typography.Text type="secondary">Indexed coverage</Typography.Text>
            <Typography.Title level={3}>{indexedCoverage}%</Typography.Title>
          </div>
        </div>
      </section>

      <div className="surface table-surface">
        <div className="collection-table-controls">
          <Input
            allowClear
            aria-label="Search collections"
            prefix={<Search size={16} />}
            placeholder="Search collections"
            value={collectionSearch}
            onChange={(event) => setCollectionSearch(event.target.value)}
          />
          <Select<CollectionHealthFilter>
            aria-label="Filter collection status"
            value={collectionHealthFilter}
            onChange={setCollectionHealthFilter}
            options={[
              { value: "all", label: "All statuses" },
              { value: "healthy", label: "Healthy" },
              { value: "optimizing", label: "Optimizing / pending" },
              { value: "degraded", label: "Degraded" },
              { value: "unavailable", label: "Unavailable" },
              { value: "unknown", label: "Unknown" },
            ]}
          />
          <Typography.Text type="secondary">
            {collections.length} of {allCollections.length}
          </Typography.Text>
        </div>
        <Table
          rowKey="name"
          columns={columns}
          dataSource={collections}
          loading={collectionsOverviewQuery.isLoading || collectionsOverviewQuery.isFetching}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          scroll={{ x: 865 }}
          locale={{
            emptyText: allCollections.length
              ? "No collections match the current filters."
              : "No collections found.",
          }}
        />
      </div>

      <Drawer
        title={selectedCollection}
        open={Boolean(selectedCollection)}
        width={760}
        onClose={closeCollectionDetails}
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
            onEditSettings={openSettingsModal}
          />
        ) : null}
      </Drawer>

      <Modal
        title="Payload indexes need attention"
        open={indexFailuresOpen && indexFailures.length > 0}
        width={1040}
        footer={
          <Space>
            <Button
              danger
              onClick={() => {
                setIndexFailures([]);
                setIndexFailuresOpen(false);
              }}
            >
              Dismiss all
            </Button>
            <Button type="primary" onClick={() => setIndexFailuresOpen(false)}>
              Close
            </Button>
          </Space>
        }
        onCancel={() => setIndexFailuresOpen(false)}
      >
        <Alert
          type="info"
          showIcon
          message="Collection creation succeeded; only the listed payload indexes failed."
          description="Expand a row to inspect the upstream response. Retrying creates only the index and does not replace the collection."
          style={{ marginBottom: 16 }}
        />
        <Table
          rowKey="key"
          columns={indexFailureColumns}
          dataSource={indexFailures}
          pagination={false}
          scroll={{ x: 980 }}
          expandable={{
            expandedRowRender: (failure) => (
              <JsonView
                data={{
                  status_code: failure.statusCode,
                  field_schema: failure.fieldSchema,
                  detail: failure.detail,
                }}
                minHeight={120}
              />
            ),
          }}
        />
      </Modal>

      <Modal
        title={`Edit and retry${retryFailure ? ` ${retryFailure.fieldName}` : ""}`}
        open={Boolean(retryFailure)}
        okText="Retry index"
        confirmLoading={retryIndexMutation.isPending}
        onOk={submitRetryIndex}
        onCancel={() => setRetryFailure(null)}
      >
        <Alert
          type="info"
          showIcon
          message={`The collection ${retryFailure?.collectionName ?? ""} already exists.`}
          description="This action retries only the payload index definition below."
          style={{ marginBottom: 16 }}
        />
        <Form layout="vertical">
          <Form.Item label="Collection">
            <Input value={retryFailure?.collectionName ?? ""} disabled />
          </Form.Item>
          <Form.Item label="Field" required>
            <Input value={retryFieldName} onChange={(event) => setRetryFieldName(event.target.value)} />
          </Form.Item>
          <Form.Item label="Field schema JSON" required>
            <Input.TextArea
              rows={8}
              value={retrySchemaJson}
              onChange={(event) => setRetrySchemaJson(event.target.value)}
              spellCheck={false}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Edit settings${selectedCollection ? ` for ${selectedCollection}` : ""}`}
        open={settingsOpen}
        width={760}
        okText="Apply settings"
        confirmLoading={updateCollectionMutation.isPending}
        onOk={() => settingsForm.submit()}
        onCancel={() => setSettingsOpen(false)}
      >
        <Alert
          type="info"
          showIcon
          message="Some changes can trigger segment optimization or vector reindexing."
          style={{ marginBottom: 16 }}
        />
        <Form
          form={settingsForm}
          layout="vertical"
          onFinish={(values) => updateCollectionMutation.mutate(values)}
        >
          <Divider orientation="left">Collection parameters</Divider>
          <div className="form-grid">
            <Form.Item label="Replication factor" name="replicationFactor">
              <InputNumber min={1} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="Write consistency" name="writeConsistencyFactor">
              <InputNumber min={1} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="On-disk payload" name="onDiskPayload" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>

          <Divider orientation="left">Optimizer</Divider>
          <div className="form-grid two">
            <Form.Item label="Indexing threshold (KB)" name="indexingThreshold">
              <InputNumber min={0} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="Flush interval (seconds)" name="flushIntervalSec">
              <InputNumber min={1} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </div>

          <Divider orientation="left">HNSW</Divider>
          <div className="form-grid two">
            <Form.Item label="M" name="hnswM">
              <InputNumber min={0} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="EF construct" name="hnswEfConstruct">
              <InputNumber min={4} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </div>

          <Divider orientation="left">Advanced update JSON</Divider>
          <Form.Item name="advancedJson">
            <Input.TextArea
              rows={6}
              spellCheck={false}
              placeholder={'{"metadata":{"owner":"local"},"strict_mode_config":{"enabled":true}}'}
            />
          </Form.Item>
        </Form>
      </Modal>

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
