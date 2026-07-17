import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Badge, ConfigProvider, Layout, Menu, Space, Tooltip, Typography, App as AntApp } from "antd";
import {
  Boxes,
  Braces,
  Cable,
  GitBranch,
  Network,
} from "lucide-react";
import { useMemo, useState } from "react";

import { AliasesPage } from "./pages/AliasesPage";
import { ClusterPage } from "./pages/ClusterPage";
import { CollectionsPage } from "./pages/CollectionsPage";
import { RestConsolePage } from "./pages/RestConsolePage";
import { api } from "./services/api";
import "./styles/app.css";

type PageKey = "collections" | "aliases" | "cluster" | "rest";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    },
  },
});

const navigation = [
  { key: "collections", icon: <Boxes size={18} />, label: "Collections" },
  { key: "aliases", icon: <GitBranch size={18} />, label: "Aliases" },
  { key: "cluster", icon: <Network size={18} />, label: "Cluster" },
  { key: "rest", icon: <Braces size={18} />, label: "REST Console" },
];

const Shell = () => {
  const [page, setPage] = useState<PageKey>("collections");
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    retry: 2,
    staleTime: 0,
    refetchInterval: (query) => (query.state.status === "error" ? 5_000 : 30_000),
  });

  const pageNode = useMemo(() => {
    if (page === "aliases") return <AliasesPage />;
    if (page === "cluster") return <ClusterPage />;
    if (page === "rest") return <RestConsolePage />;
    return <CollectionsPage />;
  }, [page]);
  const healthError = healthQuery.error instanceof Error ? healthQuery.error.message : "Qdrant is unreachable.";
  const healthState = healthQuery.isFetching ? "checking" : healthQuery.isError ? "error" : "ok";

  return (
    <Layout className="app-layout">
      <Layout.Sider width={248} className="app-sider">
        <div className="brand">
          <div className="brand-mark">
            <Cable size={22} />
          </div>
          <div>
            <Typography.Title level={1}>Qdrant Admin</Typography.Title>
            <Typography.Text>Local control plane</Typography.Text>
          </div>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[page]}
          items={navigation}
          onClick={(item) => setPage(item.key as PageKey)}
          className="nav-menu"
        />
      </Layout.Sider>
      <Layout>
        <Layout.Header className="app-header">
          <Tooltip
            title={
              healthState === "error"
                ? healthError
                : healthState === "checking"
                  ? "Checking backend and Qdrant API..."
                  : "Backend and Qdrant API are reachable."
            }
          >
            <Space>
              <Badge
                status={healthState === "error" ? "error" : healthState === "checking" ? "processing" : "success"}
              />
              <Typography.Text>
                {healthState === "error" ? "Qdrant unreachable" : healthState === "checking" ? "Checking Qdrant" : "Qdrant API"}
              </Typography.Text>
            </Space>
          </Tooltip>
        </Layout.Header>
        <Layout.Content className="app-content">{pageNode}</Layout.Content>
      </Layout>
    </Layout>
  );
};

export const RootApp = () => (
  <ConfigProvider
    theme={{
      token: {
        colorPrimary: "#4d94f5",
        borderRadius: 8,
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      },
      components: {
        Button: { controlHeight: 36 },
        Table: { headerBg: "#f5f6f8" },
      },
    }}
  >
    <AntApp>
      <QueryClientProvider client={queryClient}>
        <Shell />
      </QueryClientProvider>
    </AntApp>
  </ConfigProvider>
);
