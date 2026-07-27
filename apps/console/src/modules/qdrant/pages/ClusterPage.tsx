import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Collapse,
  Descriptions,
  Empty,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { Camera, Download, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { JsonView } from "../components/JsonView";
import { PageToolbar } from "../components/PageToolbar";
import { api, type CollectionSnapshot } from "../services/api";
import {
  getClusterMode,
  shouldRequestCollectionCluster,
  shouldRequestCollectionDetails,
  type ClusterMode,
} from "../services/cluster";

type AnyRecord = Record<string, unknown>;

interface EndpointRow {
  key: string;
  endpoint: string;
  status: string;
  count: number;
  avgDurationMicros: number;
}

interface ShardRow {
  key: string;
  shardId: string;
  location: string;
  state: string;
  points: number | string;
}

interface TransferRow {
  key: string;
  shardId: string;
  from: string;
  to: string;
  status: string;
}

const asRecord = (value: unknown): AnyRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : {};

const asNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const unwrapResult = (value: unknown) => asRecord(asRecord(value).result ?? value);

const formatBoolean = (value: unknown) => (value ? "Enabled" : "Disabled");

const formatDuration = (micros: number) => {
  if (!micros) return "0 us";
  if (micros >= 1000) return `${(micros / 1000).toFixed(1)} ms`;
  return `${micros.toFixed(1)} us`;
};

const formatDate = (value: unknown) => {
  if (typeof value !== "string") return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatBytes = (size: number) => {
  if (!Number.isFinite(size) || size < 0) return "Unknown";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
};

const flattenEndpointRows = (telemetry: AnyRecord): EndpointRow[] => {
  const requests = asRecord(telemetry.requests);
  const rest = asRecord(requests.rest);
  const responses = asRecord(rest.responses);

  return Object.entries(responses).flatMap(([endpoint, statusMap]) =>
    Object.entries(asRecord(statusMap)).map(([status, stats]) => ({
      key: `${endpoint}-${status}`,
      endpoint,
      status,
      count: asNumber(asRecord(stats).count),
      avgDurationMicros: asNumber(asRecord(stats).avg_duration_micros),
    })),
  );
};

const displayUnknown = (value: unknown) =>
  value === undefined || value === null || value === "" ? "Unknown" : String(value);

const buildShardRows = (collectionCluster: AnyRecord): ShardRow[] => {
  const localRows = (Array.isArray(collectionCluster.local_shards) ? collectionCluster.local_shards : []).map(
    (shard, index) => {
      const row = asRecord(shard);
      return {
        key: `local-${String(row.shard_id ?? index)}`,
        shardId: displayUnknown(row.shard_id),
        location: "Local",
        state: displayUnknown(row.state),
        points: asNumber(row.points_count),
      };
    },
  );

  const remoteRows = (Array.isArray(collectionCluster.remote_shards) ? collectionCluster.remote_shards : []).map(
    (shard, index) => {
      const row = asRecord(shard);
      return {
        key: `remote-${String(row.shard_id ?? index)}-${String(row.peer_id ?? "")}`,
        shardId: displayUnknown(row.shard_id),
        location: `Peer ${displayUnknown(row.peer_id)}`,
        state: displayUnknown(row.state),
        points: displayUnknown(row.points_count),
      };
    },
  );

  return [...localRows, ...remoteRows];
};

const buildTransferRows = (collectionCluster: AnyRecord): TransferRow[] =>
  (Array.isArray(collectionCluster.shard_transfers) ? collectionCluster.shard_transfers : []).map((transfer, index) => {
    const row = asRecord(transfer);
    return {
      key: `${displayUnknown(row.shard_id)}-${index}`,
      shardId: displayUnknown(row.shard_id),
      from: displayUnknown(row.from),
      to: displayUnknown(row.to),
      status: displayUnknown(row.status),
    };
  });

const buildCollectionConfigShardRows = (collectionDetails: AnyRecord): ShardRow[] => {
  const params = asRecord(asRecord(collectionDetails.config).params);
  const shardCount = Math.max(0, asNumber(params.shard_number));
  if (!shardCount) return [];

  return Array.from({ length: shardCount }, (_, index) => ({
    key: `configured-${index}`,
    shardId: String(index),
    location: "Collection config",
    state: "Configured",
    points: shardCount === 1 ? asNumber(collectionDetails.points_count) : "Unknown",
  }));
};

const getCollectionConfigShardCount = (collectionDetails: AnyRecord) => {
  const params = asRecord(asRecord(collectionDetails.config).params);
  return params.shard_number;
};

const StorageSnapshots = ({ clusterMode }: { clusterMode: ClusterMode }) => {
  const { message, modal } = AntApp.useApp();
  const queryClient = useQueryClient();
  const snapshotsQuery = useQuery({
    queryKey: ["qdrant", "snapshots", "storage"],
    queryFn: api.listStorageSnapshots,
  });
  const createSnapshotMutation = useMutation({
    mutationFn: api.createStorageSnapshot,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qdrant", "snapshots", "storage"] });
      message.success("Full storage snapshot created.");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "Failed to create storage snapshot.");
    },
  });
  const deleteSnapshotMutation = useMutation({
    mutationFn: api.deleteStorageSnapshot,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qdrant", "snapshots", "storage"] });
      message.success("Storage snapshot deleted.");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "Failed to delete storage snapshot.");
    },
  });
  const snapshots = snapshotsQuery.data?.result ?? [];
  const createDisabledReason =
    clusterMode === "enabled"
      ? "Full storage snapshots are not supported for distributed Qdrant deployments."
      : clusterMode === "unknown"
        ? "Wait for Qdrant cluster mode detection before creating a full snapshot."
        : undefined;

  const columns: ColumnsType<CollectionSnapshot> = [
    {
      title: "Snapshot",
      dataIndex: "name",
      ellipsis: true,
      render: (name: string) => (
        <Tooltip title={name}>
          <Typography.Text strong className="truncate-cell">
            {name}
          </Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: "Created",
      dataIndex: "creation_time",
      width: 190,
      render: formatDate,
    },
    {
      title: "Size",
      dataIndex: "size",
      width: 105,
      align: "right",
      render: formatBytes,
    },
    {
      title: "Checksum",
      dataIndex: "checksum",
      width: 240,
      ellipsis: true,
      render: (checksum?: string) =>
        checksum ? (
          <Typography.Text code copyable={{ text: checksum }}>
            {checksum}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">Not reported</Typography.Text>
        ),
    },
    {
      title: "Actions",
      width: 105,
      align: "right",
      render: (_, snapshot) => (
        <Space>
          <Tooltip title="Download snapshot">
            <Button
              aria-label={`Download ${snapshot.name}`}
              icon={<Download size={16} />}
              href={api.storageSnapshotDownloadUrl(snapshot.name)}
            />
          </Tooltip>
          <Tooltip title="Delete snapshot">
            <Button
              danger
              aria-label={`Delete ${snapshot.name}`}
              icon={<Trash2 size={16} />}
              loading={
                deleteSnapshotMutation.isPending &&
                deleteSnapshotMutation.variables === snapshot.name
              }
              onClick={() =>
                modal.confirm({
                  title: `Delete ${snapshot.name}?`,
                  content: "This removes the full storage backup file from Qdrant.",
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
    <section className="surface storage-snapshots-surface">
      <div className="section-heading">
        <div>
          <Typography.Title level={3}>Storage snapshots</Typography.Title>
          <Typography.Text type="secondary">
            Back up every collection and alias in this Qdrant instance.
          </Typography.Text>
        </div>
        <Space wrap>
          <Tooltip title="Refresh storage snapshots">
            <Button
              icon={<RefreshCw size={16} />}
              loading={snapshotsQuery.isFetching}
              onClick={() => snapshotsQuery.refetch()}
            />
          </Tooltip>
          <Tooltip title={createDisabledReason}>
            <span>
              <Button
                type="primary"
                icon={<Camera size={16} />}
                disabled={Boolean(createDisabledReason)}
                loading={createSnapshotMutation.isPending}
                onClick={() => createSnapshotMutation.mutate()}
              >
                Create full snapshot
              </Button>
            </span>
          </Tooltip>
        </Space>
      </div>

      <Alert
        type={clusterMode === "enabled" ? "warning" : "info"}
        showIcon
        message={
          clusterMode === "enabled"
            ? "Full storage snapshots are only suitable for single-node deployments."
            : "Restore requires restarting Qdrant with the --storage-snapshot option."
        }
        description="The web console can create, download, and delete these backups, but cannot restore an entire running instance."
        style={{ marginBottom: 12 }}
      />

      {snapshotsQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message="Unable to load storage snapshots"
          description={snapshotsQuery.error instanceof Error ? snapshotsQuery.error.message : undefined}
          action={<Button onClick={() => snapshotsQuery.refetch()}>Retry</Button>}
          style={{ marginBottom: 12 }}
        />
      ) : null}

      <Table
        rowKey="name"
        size="small"
        columns={columns}
        dataSource={snapshots}
        loading={snapshotsQuery.isLoading}
        pagination={{ pageSize: 8, hideOnSinglePage: true }}
        scroll={{ x: 860 }}
        locale={{
          emptyText: snapshotsQuery.isError
            ? "Storage snapshots unavailable"
            : "No full storage snapshots yet",
        }}
      />
    </section>
  );
};

export const ClusterPage = () => {
  const queryClient = useQueryClient();
  const [collectionName, setCollectionName] = useState<string | undefined>();

  const clusterQuery = useQuery({
    queryKey: ["qdrant", "cluster"],
    queryFn: api.getCluster,
  });

  const telemetryQuery = useQuery({
    queryKey: ["qdrant", "cluster", "telemetry"],
    queryFn: api.getTelemetry,
  });

  const collectionsQuery = useQuery({
    queryKey: ["qdrant", "collections"],
    queryFn: api.listCollections,
  });

  const clusterMode = getClusterMode(clusterQuery.data);
  const clusterStatusSettled = clusterQuery.isSuccess || clusterQuery.isError;

  const collectionClusterQuery = useQuery({
    queryKey: ["qdrant", "collections", collectionName, "cluster"],
    queryFn: () => api.getCollectionCluster(collectionName!),
    enabled: shouldRequestCollectionCluster(
      Boolean(collectionName),
      clusterQuery.isSuccess,
      clusterMode,
    ),
  });

  const collectionDetailsQuery = useQuery({
    queryKey: ["qdrant", "collections", collectionName],
    queryFn: () => api.getCollection(collectionName!),
    enabled: shouldRequestCollectionDetails(
      Boolean(collectionName),
      clusterStatusSettled,
      clusterMode,
      collectionClusterQuery.isError,
    ),
  });

  const refreshAll = () => {
    clusterQuery.refetch();
    telemetryQuery.refetch();
    collectionsQuery.refetch();
    queryClient.invalidateQueries({ queryKey: ["qdrant", "snapshots", "storage"] });
    if (collectionName) {
      if (clusterMode === "enabled") {
        collectionClusterQuery.refetch();
      }
      if (clusterMode !== "enabled" || collectionClusterQuery.isError) {
        collectionDetailsQuery.refetch();
      }
    }
  };

  const collectionOptions =
    collectionsQuery.data?.result?.collections.map((collection) => ({
      value: collection.name,
      label: collection.name,
    })) ?? [];

  const clusterStatus = unwrapResult(clusterQuery.data);
  const telemetry = unwrapResult(telemetryQuery.data);
  const telemetryApp = asRecord(telemetry.app);
  const telemetryCollections = asRecord(telemetry.collections);
  const telemetryCluster = asRecord(telemetry.cluster);
  const collectionCluster = unwrapResult(collectionClusterQuery.data);
  const collectionDetails = unwrapResult(collectionDetailsQuery.data);
  const shardRows = useMemo(() => buildShardRows(collectionCluster), [collectionCluster]);
  const transferRows = useMemo(() => buildTransferRows(collectionCluster), [collectionCluster]);
  const configShardRows = useMemo(() => buildCollectionConfigShardRows(collectionDetails), [collectionDetails]);
  const usingCollectionConfig =
    Boolean(collectionName) &&
    clusterStatusSettled &&
    (clusterMode !== "enabled" || collectionClusterQuery.isError);
  const displayedShardRows = shardRows.length ? shardRows : usingCollectionConfig ? configShardRows : [];
  const endpointRows = useMemo(() => flattenEndpointRows(telemetry), [telemetry]);
  const showingConfigFallback = usingCollectionConfig && configShardRows.length > 0;
  const shardPanelLoading =
    Boolean(collectionName) &&
    (clusterQuery.isLoading || collectionClusterQuery.isFetching || collectionDetailsQuery.isFetching);
  const shardCount = collectionCluster.shard_count ?? getCollectionConfigShardCount(collectionDetails);
  const rawShardData = collectionClusterQuery.data ?? collectionDetailsQuery.data ?? null;

  const shardColumns: ColumnsType<ShardRow> = [
    { title: "Shard", dataIndex: "shardId", width: 90 },
    { title: "Location", dataIndex: "location" },
    {
      title: "State",
      dataIndex: "state",
      width: 120,
      render: (value: string) => <Tag color={value === "Active" ? "blue" : "default"}>{value}</Tag>,
    },
    { title: "Points", dataIndex: "points", width: 100 },
  ];

  const transferColumns: ColumnsType<TransferRow> = [
    { title: "Shard", dataIndex: "shardId", width: 90 },
    { title: "From", dataIndex: "from" },
    { title: "To", dataIndex: "to" },
    { title: "Status", dataIndex: "status", width: 120 },
  ];

  const endpointColumns: ColumnsType<EndpointRow> = [
    {
      title: "Endpoint",
      dataIndex: "endpoint",
      ellipsis: true,
      render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 100,
      render: (value: string) => <Tag color={value.startsWith("2") ? "blue" : "orange"}>{value}</Tag>,
    },
    {
      title: "Count",
      dataIndex: "count",
      width: 110,
      sorter: (a, b) => a.count - b.count,
    },
    {
      title: "Avg latency",
      dataIndex: "avgDurationMicros",
      width: 130,
      render: (value: number) => formatDuration(value),
      sorter: (a, b) => a.avgDurationMicros - b.avgDurationMicros,
    },
  ];

  return (
    <>
      <PageToolbar
        title="Cluster"
        subtitle="Inspect cluster state, storage backups, telemetry, and collection shard placement."
        actions={
          <Button
            icon={<RefreshCw size={16} />}
            onClick={refreshAll}
            loading={clusterQuery.isFetching || telemetryQuery.isFetching}
          >
            Refresh
          </Button>
        }
      />

      {clusterQuery.isError ? (
        <Alert
          type="warning"
          showIcon
          message="Cluster endpoint is unavailable"
          description={
            clusterQuery.error instanceof Error
              ? `${clusterQuery.error.message} Single-node Qdrant instances often have clustering disabled.`
              : "Single-node Qdrant instances often have clustering disabled."
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <div className="cluster-grid">
        <section className="surface cluster-panel">
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Typography.Title level={3}>Cluster status</Typography.Title>
            {clusterQuery.isLoading ? (
              <Spin />
            ) : (
              <>
                <div className="status-panel">
                  <div>
                    <Typography.Text type="secondary">Mode</Typography.Text>
                    <div>
                      <Tag color={clusterStatus.status === "enabled" ? "blue" : "default"}>
                        {String(clusterStatus.status ?? "unknown")}
                      </Tag>
                    </div>
                  </div>
                  <div>
                    <Typography.Text type="secondary">Qdrant status</Typography.Text>
                    <Typography.Title level={4}>{String(asRecord(clusterQuery.data).status ?? "unknown")}</Typography.Title>
                  </div>
                  <div>
                    <Typography.Text type="secondary">Response time</Typography.Text>
                    <Typography.Title level={4}>
                      {formatDuration(asNumber(asRecord(clusterQuery.data).time) * 1_000_000)}
                    </Typography.Title>
                  </div>
                </div>
                <Alert
                  type={clusterStatus.status === "disabled" ? "info" : "success"}
                  showIcon
                  message={
                    clusterStatus.status === "disabled"
                      ? "This Qdrant instance is running in single-node mode."
                      : "Qdrant clustering is enabled."
                  }
                />
                <Collapse
                  size="small"
                  items={[
                    {
                      key: "raw-cluster",
                      label: "Raw cluster response",
                      children: <JsonView data={clusterQuery.data ?? null} minHeight={180} />,
                    },
                  ]}
                />
              </>
            )}
          </Space>
        </section>

        <section className="surface cluster-panel">
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Typography.Title level={3}>Collection shards</Typography.Title>
            <Select
              allowClear
              showSearch
              placeholder="Select collection"
              options={collectionOptions}
              value={collectionName}
              onChange={setCollectionName}
              loading={collectionsQuery.isLoading || collectionsQuery.isFetching}
            />
            {collectionsQuery.isError ? (
              <Alert
                type="error"
                showIcon
                message="Unable to load collection list"
                description={collectionsQuery.error instanceof Error ? collectionsQuery.error.message : undefined}
                action={
                  <Button size="small" onClick={() => collectionsQuery.refetch()}>
                    Retry
                  </Button>
                }
              />
            ) : null}
            {collectionName && clusterMode === "disabled" ? (
              <Alert
                type="info"
                showIcon
                message="Single-node mode: showing collection configuration"
                description="Qdrant cluster placement is disabled, so shard count and point totals come from the collection details endpoint."
              />
            ) : null}
            {collectionName && clusterQuery.isError ? (
              <Alert
                type="warning"
                showIcon
                message="Cluster status unavailable, showing collection configuration"
                description={clusterQuery.error instanceof Error ? clusterQuery.error.message : undefined}
              />
            ) : null}
            {collectionClusterQuery.isError ? (
              <Alert
                type={showingConfigFallback ? "info" : "warning"}
                showIcon
                message={
                  showingConfigFallback
                    ? "Shard endpoint unavailable, showing collection config"
                    : "Unable to load collection shard details"
                }
                description={
                  collectionClusterQuery.error instanceof Error
                    ? collectionClusterQuery.error.message
                    : "Check that the Python API is running and Qdrant exposes this collection cluster endpoint."
                }
                action={
                  <Button size="small" onClick={() => collectionClusterQuery.refetch()}>
                    Retry
                  </Button>
                }
              />
            ) : null}
            {collectionDetailsQuery.isError ? (
              <Alert
                type="error"
                showIcon
                message="Unable to load collection configuration"
                description={
                  collectionDetailsQuery.error instanceof Error
                    ? collectionDetailsQuery.error.message
                    : undefined
                }
                action={
                  <Button size="small" onClick={() => collectionDetailsQuery.refetch()}>
                    Retry
                  </Button>
                }
              />
            ) : null}
            {shardPanelLoading ? <Spin /> : null}
            {(collectionClusterQuery.data || collectionDetailsQuery.data) && collectionName ? (
              <>
                <Descriptions
                  bordered
                  size="small"
                  column={1}
                  items={[
                    {
                      key: "peer",
                      label: "Peer ID",
                      children: usingCollectionConfig
                        ? "Single node"
                        : displayUnknown(collectionCluster.peer_id),
                    },
                    { key: "count", label: "Shard count", children: displayUnknown(shardCount) },
                    { key: "transfers", label: "Transfers", children: String(transferRows.length) },
                  ]}
                />
                {displayedShardRows.length ? (
                  <Table
                    rowKey="key"
                    size="small"
                    columns={shardColumns}
                    dataSource={displayedShardRows}
                    pagination={false}
                  />
                ) : (
                  <Empty description="No shard rows reported" />
                )}
                {transferRows.length ? (
                  <>
                    <Typography.Title level={4}>Shard transfers</Typography.Title>
                    <Table
                      rowKey="key"
                      size="small"
                      columns={transferColumns}
                      dataSource={transferRows}
                      pagination={false}
                    />
                  </>
                ) : null}
                <Collapse
                  size="small"
                  items={[
                    {
                      key: "raw-collection-cluster",
                      label: collectionClusterQuery.data ? "Raw shard response" : "Raw collection response",
                      children: <JsonView data={rawShardData} minHeight={220} />,
                    },
                  ]}
                />
              </>
            ) : !collectionName ? (
              <Typography.Text type="secondary">Select a collection to inspect shard state.</Typography.Text>
            ) : null}
          </Space>
        </section>
      </div>

      <StorageSnapshots clusterMode={clusterMode} />

      <section className="surface telemetry-panel">
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Title level={3}>Telemetry</Typography.Title>
          {telemetryQuery.isError ? (
            <Alert
              type="error"
              showIcon
              message="Unable to load telemetry"
              description={telemetryQuery.error instanceof Error ? telemetryQuery.error.message : undefined}
            />
          ) : null}
          {telemetryQuery.isLoading ? (
            <Spin />
          ) : (
            <>
              <div className="metrics-grid">
                <div className="metric-tile">
                  <Statistic title="Version" value={String(telemetryApp.version ?? "Unknown")} />
                </div>
                <div className="metric-tile">
                  <Statistic
                    title="Collections"
                    value={asNumber(telemetryCollections.number_of_collections)}
                  />
                </div>
                <div className="metric-tile">
                  <Statistic title="Cluster" value={formatBoolean(telemetryCluster.enabled)} />
                </div>
                <div className="metric-tile">
                  <Statistic title="Resharding" value={formatBoolean(telemetryCluster.resharding_enabled)} />
                </div>
              </div>

              <Descriptions
                bordered
                size="small"
                column={{ xs: 1, sm: 2, lg: 3 }}
                items={[
                  { key: "name", label: "Service", children: String(telemetryApp.name ?? "qdrant") },
                  { key: "id", label: "Node ID", children: String(telemetry.id ?? "Unknown") },
                  { key: "startup", label: "Started", children: formatDate(telemetryApp.startup) },
                ]}
              />

              <Typography.Title level={4}>REST traffic</Typography.Title>
              {endpointRows.length ? (
                <Table
                  rowKey="key"
                  size="small"
                  columns={endpointColumns}
                  dataSource={endpointRows}
                  pagination={{ pageSize: 8, hideOnSinglePage: true }}
                />
              ) : (
                <Empty description="No REST request statistics yet" />
              )}

              <Collapse
                size="small"
                items={[
                  {
                    key: "raw-telemetry",
                    label: "Raw telemetry response",
                    children: <JsonView data={telemetryQuery.data ?? null} minHeight={260} />,
                  },
                ]}
              />
            </>
          )}
        </Space>
      </section>
    </>
  );
};
