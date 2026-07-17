import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  App as AntApp,
  Badge,
  ConfigProvider,
  Layout,
  Menu,
  Space,
  Spin,
  Tooltip,
  Typography,
} from "antd";
import {
  Boxes,
  Braces,
  Cable,
  GitBranch,
  Network,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";

import { api } from "./services/api";
import {
  getPageDocumentTitle,
  getPageFromPath,
  getPagePath,
  type PageKey,
} from "./services/navigation";
import "./styles/app.css";

const CollectionsPage = lazy(() =>
  import("./pages/CollectionsPage").then((module) => ({ default: module.CollectionsPage })),
);
const AliasesPage = lazy(() =>
  import("./pages/AliasesPage").then((module) => ({ default: module.AliasesPage })),
);
const ClusterPage = lazy(() =>
  import("./pages/ClusterPage").then((module) => ({ default: module.ClusterPage })),
);
const RestConsolePage = lazy(() =>
  import("./pages/RestConsolePage").then((module) => ({ default: module.RestConsolePage })),
);

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

const PageLoading = () => (
  <div className="surface page-loading" role="status" aria-live="polite">
    <Spin size="large" />
    <Typography.Text type="secondary">Loading view...</Typography.Text>
  </div>
);

const Shell = () => {
  const [page, setPage] = useState<PageKey>(
    () => getPageFromPath(window.location.pathname) ?? "collections",
  );
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    retry: 2,
    staleTime: 0,
    refetchInterval: (query) => (query.state.status === "error" ? 5_000 : 30_000),
  });

  const pageNode = (() => {
    if (page === "aliases") return <AliasesPage />;
    if (page === "cluster") return <ClusterPage />;
    if (page === "rest") return <RestConsolePage />;
    return <CollectionsPage />;
  })();
  const healthError = healthQuery.error instanceof Error ? healthQuery.error.message : "Qdrant is unreachable.";
  const healthState = healthQuery.isFetching ? "checking" : healthQuery.isError ? "error" : "ok";

  useEffect(() => {
    const syncPageFromLocation = () => {
      const nextPage = getPageFromPath(window.location.pathname) ?? "collections";
      const canonicalPath = getPagePath(nextPage);
      if (window.location.pathname !== canonicalPath) {
        window.history.replaceState(window.history.state, "", canonicalPath);
      }
      setPage(nextPage);
    };

    syncPageFromLocation();
    window.addEventListener("popstate", syncPageFromLocation);
    return () => window.removeEventListener("popstate", syncPageFromLocation);
  }, []);

  useEffect(() => {
    document.title = getPageDocumentTitle(page);
  }, [page]);

  const navigateTo = (nextPage: PageKey) => {
    const nextPath = getPagePath(nextPage);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ page: nextPage }, "", nextPath);
    }
    setPage(nextPage);
  };

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
          onClick={(item) => navigateTo(item.key as PageKey)}
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
        <Layout.Content className="app-content">
          <Suspense fallback={<PageLoading />}>{pageNode}</Suspense>
        </Layout.Content>
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
