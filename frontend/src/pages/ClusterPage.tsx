import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Select, Space, Spin, Typography } from "antd";
import { RefreshCw } from "lucide-react";
import { useState } from "react";

import { JsonView } from "../components/JsonView";
import { PageToolbar } from "../components/PageToolbar";
import { api } from "../services/api";

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
            {clusterQuery.isLoading ? <Spin /> : <JsonView data={clusterQuery.data ?? null} minHeight={260} />}
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
              <JsonView data={collectionClusterQuery.data} minHeight={260} />
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
          {telemetryQuery.isLoading ? <Spin /> : <JsonView data={telemetryQuery.data ?? null} minHeight={360} />}
        </Space>
      </section>
    </>
  );
};
