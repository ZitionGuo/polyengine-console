import { useQuery } from "@tanstack/react-query";
import {
  Alert,
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
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import { JsonView } from "../components/JsonView";
import { PageToolbar } from "../components/PageToolbar";
import { api } from "../services/api";

type AnyRecord = Record<string, unknown>;

interface EndpointRow {
  key: string;
  endpoint: string;
  status: string;
  count: number;
  avgDurationMicros: number;
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

export const ClusterPage = () => {
  const [collectionName, setCollectionName] = useState<string | undefined>();

  const clusterQuery = useQuery({
    queryKey: ["cluster"],
    queryFn: api.getCluster,
  });

  const telemetryQuery = useQuery({
    queryKey: ["cluster", "telemetry"],
    queryFn: api.getTelemetry,
  });

  const collectionsQuery = useQuery({
    queryKey: ["collections"],
    queryFn: api.listCollections,
  });

  const collectionClusterQuery = useQuery({
    queryKey: ["collections", collectionName, "cluster"],
    queryFn: () => api.getCollectionCluster(collectionName!),
    enabled: Boolean(collectionName),
  });

  const refreshAll = () => {
    clusterQuery.refetch();
    telemetryQuery.refetch();
    collectionClusterQuery.refetch();
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
  const endpointRows = useMemo(() => flattenEndpointRows(telemetry), [telemetry]);

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
        subtitle="Inspect Qdrant cluster state, telemetry, and collection shard placement."
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
        <section className="surface" style={{ padding: 16 }}>
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

        <section className="surface" style={{ padding: 16 }}>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Typography.Title level={3}>Collection shards</Typography.Title>
            <Select
              allowClear
              showSearch
              placeholder="Select collection"
              options={collectionOptions}
              value={collectionName}
              onChange={setCollectionName}
            />
            {collectionClusterQuery.isError ? (
              <Alert
                type="info"
                showIcon
                message="Collection cluster details unavailable"
                description={
                  collectionClusterQuery.error instanceof Error
                    ? collectionClusterQuery.error.message
                    : undefined
                }
              />
            ) : null}
            {collectionClusterQuery.isFetching ? <Spin /> : null}
            {collectionClusterQuery.data ? (
              <Collapse
                size="small"
                defaultActiveKey={["raw-collection-cluster"]}
                items={[
                  {
                    key: "raw-collection-cluster",
                    label: "Collection shard response",
                    children: <JsonView data={collectionClusterQuery.data} minHeight={220} />,
                  },
                ]}
              />
            ) : (
              <Typography.Text type="secondary">Select a collection to inspect shard state.</Typography.Text>
            )}
          </Space>
        </section>
      </div>

      <section className="surface" style={{ padding: 16, marginTop: 16 }}>
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
