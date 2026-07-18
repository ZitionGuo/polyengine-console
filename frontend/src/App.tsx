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
  HardDrive,
  Network,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";

import { api } from "./services/api";
import {
  getCollectionNameFromPath,
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

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

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
  const activeNavigation = navigation.find((item) => item.key === page);
  const qdrantVersion = asRecord(healthQuery.data?.qdrant).version;

  useEffect(() => {
    const syncPageFromLocation = () => {
      const nextPage = getPageFromPath(window.location.pathname) ?? "collections";
      const canonicalPath = getPagePath(nextPage);
      const isCollectionDetailPath = Boolean(
        getCollectionNameFromPath(window.location.pathname),
      );
      if (window.location.pathname !== canonicalPath && !isCollectionDetailPath) {
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
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
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
        <div className="sider-footer">
          <div className="sider-footer-icon">
            <HardDrive size={16} />
          </div>
          <div>
            <Typography.Text>Local instance</Typography.Text>
            <Typography.Text>{qdrantVersion ? `Qdrant ${String(qdrantVersion)}` : "Qdrant"}</Typography.Text>
          </div>
        </div>
      </Layout.Sider>
      <Layout>
        <Layout.Header className="app-header">
          <div className="header-context">
            <Typography.Text>Local workspace</Typography.Text>
            <Typography.Text strong>{activeNavigation?.label}</Typography.Text>
          </div>
          <Tooltip
            title={
              healthState === "error"
                ? healthError
                : healthState === "checking"
                  ? "Checking backend and Qdrant API..."
                  : "Backend and Qdrant API are reachable."
            }
          >
            <Space className={`health-pill health-pill-${healthState}`}>
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
        colorPrimary: "#e25555",
        colorInfo: "#477f9d",
        colorSuccess: "#23866b",
        colorWarning: "#c9852b",
        colorText: "#20252b",
        colorTextSecondary: "#697078",
        colorBorder: "#dfe2e6",
        colorBgLayout: "#f2f3f5",
        borderRadius: 6,
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      },
      components: {
        Button: { controlHeight: 36, fontWeight: 550, primaryShadow: "none" },
        Input: { activeShadow: "0 0 0 2px rgba(226, 85, 85, 0.12)" },
        Menu: { itemBorderRadius: 5, itemHeight: 42 },
        Table: { headerBg: "#f6f7f8", headerColor: "#545b63", rowHoverBg: "#fafbfc" },
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
