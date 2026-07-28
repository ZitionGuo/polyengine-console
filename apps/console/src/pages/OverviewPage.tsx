import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Skeleton, Space, Tag, Tooltip, Typography } from "antd";
import {
  ArrowRight,
  Boxes,
  BrainCircuit,
  Database,
  RefreshCw,
  Search,
  Server,
} from "lucide-react";

import type { AppPage } from "../engineRegistry";
import {
  api as qdrantApi,
  type QdrantEnvelope,
} from "../modules/qdrant/services/api";
import {
  api as solrApi,
  errorMessage,
} from "../modules/solr/services/api";
import { EmbeddingCacheClearButton } from "../modules/solr/components/EmbeddingCacheClearButton";

interface OverviewPageProps {
  onNavigate: (page: AppPage) => void;
}

type StatusTone = "checking" | "offline" | "online";

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const qdrantVersion = (value: unknown) => {
  const root = asRecord(value);
  const result = asRecord(root.result);
  const version = root.version ?? result.version;
  return typeof version === "string" ? version : "Available";
};

const clusterMode = (value: QdrantEnvelope<Record<string, unknown>> | undefined) => {
  const result = asRecord(value?.result);
  const status = result.status;
  return status === "disabled" ? "Single node" : typeof status === "string" ? status : "Unknown";
};

const queryError = (value: unknown) =>
  value instanceof Error ? value.message : "The engine did not respond.";

const endpointLabel = (value: string | undefined, fallback: string) => {
  if (!value) return fallback;
  try {
    const parsed = new URL(value);
    const path = parsed.pathname.replace(/\/$/, "");
    return `${parsed.host}${path === "/" ? "" : path}`;
  } catch {
    return value;
  }
};

const StatusPill = ({ tone }: { tone: StatusTone }) => (
  <Tag
    className={`engine-status engine-status-${tone}`}
    bordered={false}
  >
    <span className="engine-status-dot" />
    {tone === "online" ? "Connected" : tone === "checking" ? "Checking" : "Unavailable"}
  </Tag>
);

export const OverviewPage = ({ onNavigate }: OverviewPageProps) => {
  const cache = useQueryClient();
  const qdrantHealth = useQuery({
    queryKey: ["qdrant", "health"],
    queryFn: qdrantApi.health,
    staleTime: 0,
    refetchInterval: 30_000,
  });
  const qdrantCollections = useQuery({
    queryKey: ["qdrant", "collections"],
    queryFn: qdrantApi.listCollections,
    enabled: qdrantHealth.isSuccess,
  });
  const qdrantCluster = useQuery({
    queryKey: ["qdrant", "cluster"],
    queryFn: qdrantApi.getCluster,
    enabled: qdrantHealth.isSuccess,
  });
  const solrHealth = useQuery({
    queryKey: ["solr", "health"],
    queryFn: solrApi.health,
    staleTime: 0,
    refetchInterval: 30_000,
  });
  const solrCollections = useQuery({
    queryKey: ["solr", "collections"],
    queryFn: solrApi.collections,
    enabled: solrHealth.isSuccess,
  });
  const loadModel = useMutation({
    mutationFn: solrApi.loadModel,
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["solr", "health"] });
      void cache.invalidateQueries({ queryKey: ["solr", "model"] });
    },
  });

  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ["qdrant"] });
    void cache.invalidateQueries({ queryKey: ["solr"] });
  };

  const qdrantTone: StatusTone = qdrantHealth.isPending
    ? "checking"
    : qdrantHealth.isError
      ? "offline"
      : "online";
  const solrTone: StatusTone = solrHealth.isPending
    ? "checking"
    : solrHealth.isError
      ? "offline"
      : "online";
  const qdrantCount =
    qdrantCollections.data?.result?.collections?.length;
  const solrCount = solrCollections.data?.collections.length;
  const model = solrHealth.data?.model;

  return (
    <div className="overview-page">
      <div className="overview-heading">
        <div>
          <Typography.Text className="page-eyebrow">CONTROL PLANE</Typography.Text>
          <Typography.Title level={2}>Engine overview</Typography.Title>
          <Typography.Paragraph type="secondary">
            Live connectivity and workload context for every configured search engine.
          </Typography.Paragraph>
        </div>
        <Button
          icon={<RefreshCw size={16} />}
          loading={qdrantHealth.isFetching || solrHealth.isFetching}
          onClick={refresh}
        >
          Refresh
        </Button>
      </div>

      <section className="engine-grid" aria-label="Configured engines">
        <article className="engine-card">
          <div className="engine-card-accent engine-card-accent-qdrant" />
          <div className="engine-card-header">
            <div className="engine-identity">
              <div className="engine-icon engine-icon-qdrant">
                <Database size={20} />
              </div>
              <div>
                <Typography.Title level={3}>Qdrant</Typography.Title>
                <Typography.Text type="secondary">Vector database operations</Typography.Text>
              </div>
            </div>
            <StatusPill tone={qdrantTone} />
          </div>

          {qdrantHealth.isPending ? (
            <Skeleton active paragraph={{ rows: 2 }} title={false} />
          ) : qdrantHealth.isError ? (
            <Alert
              type="error"
              showIcon
              message="Qdrant is unreachable"
              description={queryError(qdrantHealth.error)}
            />
          ) : (
            <div className="engine-metrics">
              <div>
                <span>Version</span>
                <strong>{qdrantVersion(qdrantHealth.data?.qdrant)}</strong>
              </div>
              <div>
                <span>Collections</span>
                <strong>{qdrantCount ?? "—"}</strong>
              </div>
              <div>
                <span>Deployment</span>
                <strong>{clusterMode(qdrantCluster.data)}</strong>
              </div>
            </div>
          )}

          <div className="engine-card-footer">
            <Tooltip title={qdrantHealth.data?.endpoint ?? "Qdrant REST endpoint"}>
              <code>{endpointLabel(qdrantHealth.data?.endpoint, "localhost:6333")}</code>
            </Tooltip>
            <Space>
              <Button
                icon={<Boxes size={15} />}
                onClick={() => onNavigate("qdrant-collections")}
              >
                Collections
              </Button>
              <Button
                type="primary"
                icon={<ArrowRight size={15} />}
                onClick={() => onNavigate("qdrant-rest")}
              >
                REST
              </Button>
            </Space>
          </div>
        </article>

        <article className="engine-card">
          <div className="engine-card-accent engine-card-accent-solr" />
          <div className="engine-card-header">
            <div className="engine-identity">
              <div className="engine-icon engine-icon-solr">
                <Server size={20} />
              </div>
              <div>
                <Typography.Title level={3}>Solr</Typography.Title>
                <Typography.Text type="secondary">Semantic search workbench</Typography.Text>
              </div>
            </div>
            <StatusPill tone={solrTone} />
          </div>

          {solrHealth.isPending ? (
            <Skeleton active paragraph={{ rows: 2 }} title={false} />
          ) : solrHealth.isError ? (
            <Alert
              type="error"
              showIcon
              message="Solr is unreachable"
              description={errorMessage(solrHealth.error)}
            />
          ) : (
            <div className="engine-metrics">
              <div>
                <span>Version</span>
                <strong>{solrHealth.data?.solr.version ?? "Available"}</strong>
              </div>
              <div>
                <span>Collections</span>
                <strong>{solrCount ?? "—"}</strong>
              </div>
              <div>
                <span>Embedding model</span>
                <Tooltip
                  title={model?.query_cache
                    ? `${model.name} · ${model.query_cache.entries}/${model.query_cache.capacity} cached queries`
                    : model?.name}
                >
                  <strong className="metric-with-icon">
                    <BrainCircuit size={15} />
                    {model?.status === "ready" ? "Ready" : model?.status === "loading" ? "Loading" : "Not loaded"}
                  </strong>
                </Tooltip>
              </div>
            </div>
          )}

          <div className="engine-card-footer">
            <Tooltip title={solrHealth.data?.solr.endpoint ?? "Solr REST endpoint"}>
              <code>{endpointLabel(solrHealth.data?.solr.endpoint, "localhost:8983")}</code>
            </Tooltip>
            <Space>
              {solrHealth.isSuccess && model?.status !== "ready" ? (
                <Button
                  icon={<BrainCircuit size={15} />}
                  loading={loadModel.isPending}
                  onClick={() => loadModel.mutate()}
                >
                  Load model
                </Button>
              ) : null}
              {model?.status === "ready" && (model.query_cache?.entries ?? 0) > 0 ? (
                <EmbeddingCacheClearButton
                  entries={model.query_cache?.entries}
                  showLabel
                />
              ) : null}
              <Button
                type="primary"
                icon={<Search size={15} />}
                onClick={() => onNavigate("solr-search")}
              >
                Search
              </Button>
            </Space>
          </div>
        </article>
      </section>

      <section className="workspace-strip">
        <div className="workspace-strip-icon">
          <Server size={18} />
        </div>
        <div>
          <Typography.Text strong>Independent engine services</Typography.Text>
          <Typography.Text type="secondary">
            Qdrant and Solr keep separate API processes, health checks, and cached data.
          </Typography.Text>
        </div>
      </section>
    </div>
  );
};
