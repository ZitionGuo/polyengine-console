import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  App as AntApp,
  Badge,
  Button,
  ConfigProvider,
  Drawer,
  Layout,
  Menu,
  Skeleton,
  Space,
  Tooltip,
  Typography,
  type MenuProps,
} from "antd";
import {
  Boxes,
  Braces,
  Cable,
  DatabaseZap,
  GitBranch,
  LayoutDashboard,
  Menu as MenuIcon,
  Network,
  RefreshCw,
  Search,
  Waypoints,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { engineRegistry, type AppPage } from "./engineRegistry";
import { api as qdrantApi } from "./modules/qdrant/services/api";
import { api as solrApi } from "./modules/solr/services/api";
import { documentTitle, resolveAppRoute, routeForPage, type AppRoute } from "./navigation";
import "./modules/qdrant/qdrant.css";
import "./modules/solr/solr.css";
import "./styles/app.css";

const OverviewPage = lazy(() =>
  import("./pages/OverviewPage").then((module) => ({ default: module.OverviewPage })),
);
const QdrantCollectionsPage = lazy(() =>
  import("./modules/qdrant/pages/CollectionsPage").then((module) => ({
    default: module.CollectionsPage,
  })),
);
const QdrantAliasesPage = lazy(() =>
  import("./modules/qdrant/pages/AliasesPage").then((module) => ({
    default: module.AliasesPage,
  })),
);
const QdrantClusterPage = lazy(() =>
  import("./modules/qdrant/pages/ClusterPage").then((module) => ({
    default: module.ClusterPage,
  })),
);
const QdrantRestPage = lazy(() =>
  import("./modules/qdrant/pages/RestConsolePage").then((module) => ({
    default: module.RestConsolePage,
  })),
);
const SolrCollectionsPage = lazy(() =>
  import("./modules/solr/pages/CollectionsPage").then((module) => ({
    default: module.CollectionsPage,
  })),
);
const SolrSearchPage = lazy(() =>
  import("./modules/solr/pages/VectorSearchPage").then((module) => ({
    default: module.VectorSearchPage,
  })),
);
const SolrIngestPage = lazy(() =>
  import("./modules/solr/pages/IngestPage").then((module) => ({
    default: module.IngestPage,
  })),
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

const iconMap = {
  aliases: <GitBranch size={17} />,
  cluster: <Network size={17} />,
  collections: <Boxes size={17} />,
  ingest: <DatabaseZap size={17} />,
  rest: <Braces size={17} />,
  search: <Search size={17} />,
};

const menuItems: MenuProps["items"] = [
  {
    key: "overview",
    icon: <LayoutDashboard size={17} />,
    label: "Overview",
  },
  ...engineRegistry.map((engine) => ({
    type: "group" as const,
    key: engine.id,
    label: engine.label,
    children: engine.navigation.map((item) => ({
      key: item.key,
      icon: iconMap[item.icon],
      label: item.label,
    })),
  })),
];

const HealthIndicator = ({
  engine,
  fetching,
  failed,
  detail,
}: {
  engine: string;
  fetching: boolean;
  failed: boolean;
  detail: string;
}) => (
  <Tooltip title={detail}>
    <Space size={7} className="header-engine-status">
      <Badge status={failed ? "error" : fetching ? "processing" : "success"} />
      <Typography.Text>{engine}</Typography.Text>
    </Space>
  </Tooltip>
);

const NavigationMenu = ({
  page,
  onNavigate,
}: {
  page: AppPage;
  onNavigate: (page: AppPage) => void;
}) => (
  <Menu
    mode="inline"
    selectedKeys={[page]}
    items={menuItems}
    onClick={(item) => onNavigate(item.key as AppPage)}
    className="global-nav"
  />
);

const Brand = () => (
  <div className="global-brand">
    <div className="global-brand-mark">
      <Waypoints size={22} />
    </div>
    <div className="global-brand-copy">
      <Typography.Title level={1}>PolyEngine</Typography.Title>
      <Typography.Text>Console</Typography.Text>
    </div>
  </div>
);

const PageLoading = () => (
  <div className="surface global-page-loading" role="status" aria-live="polite">
    <Skeleton active paragraph={{ rows: 8 }} />
  </div>
);

const pageContent = (
  page: AppPage,
  onNavigate: (page: AppPage) => void,
) => {
  if (page === "overview") return <OverviewPage onNavigate={onNavigate} />;
  if (page === "qdrant-aliases") return <QdrantAliasesPage />;
  if (page === "qdrant-cluster") return <QdrantClusterPage />;
  if (page === "qdrant-rest") return <QdrantRestPage />;
  if (page === "solr-collections") return <SolrCollectionsPage />;
  if (page === "solr-search") return <SolrSearchPage />;
  if (page === "solr-ingest") return <SolrIngestPage />;
  return <QdrantCollectionsPage />;
};

const routeAtLocation = () => resolveAppRoute(window.location.pathname);

const Shell = () => {
  const initial = useMemo(routeAtLocation, []);
  const [route, setRoute] = useState<AppRoute>(initial.route);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const cache = useQueryClient();
  const qdrantHealth = useQuery({
    queryKey: ["qdrant", "health"],
    queryFn: qdrantApi.health,
    retry: 2,
    staleTime: 0,
    refetchInterval: 30_000,
  });
  const solrHealth = useQuery({
    queryKey: ["solr", "health"],
    queryFn: solrApi.health,
    retry: 2,
    staleTime: 0,
    refetchInterval: 30_000,
  });

  const syncRoute = () => {
    const resolved = routeAtLocation();
    if (window.location.pathname !== resolved.canonicalPath) {
      window.history.replaceState(window.history.state, "", resolved.canonicalPath);
    }
    setRoute(resolved.route);
  };

  useEffect(() => {
    syncRoute();
    const handleSolrNavigate = (event: Event) => {
      const page = (event as CustomEvent<"collections" | "search" | "ingest">).detail;
      navigateTo(`solr-${page}` as AppPage);
    };
    window.addEventListener("popstate", syncRoute);
    window.addEventListener("solr:navigate", handleSolrNavigate);
    return () => {
      window.removeEventListener("popstate", syncRoute);
      window.removeEventListener("solr:navigate", handleSolrNavigate);
    };
  }, []);

  useEffect(() => {
    document.title = documentTitle(route);
  }, [route]);

  const navigateTo = (page: AppPage) => {
    const nextRoute = routeForPage(page);
    if (window.location.pathname !== nextRoute.path) {
      window.history.pushState({ page }, "", nextRoute.path);
    }
    setRoute(nextRoute);
    setNavigationOpen(false);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const refresh = () => {
    if (route.engine) {
      void cache.invalidateQueries({ queryKey: [route.engine] });
      return;
    }
    void cache.invalidateQueries();
  };

  const qdrantMessage = qdrantHealth.isError
    ? qdrantHealth.error instanceof Error
      ? qdrantHealth.error.message
      : "Qdrant API is unavailable."
    : "Qdrant API is reachable.";
  const solrMessage = solrHealth.isError
    ? solrHealth.error instanceof Error
      ? solrHealth.error.message
      : "Solr API is unavailable."
    : "Solr API is reachable.";

  return (
    <Layout className="polyengine-shell">
      <Layout.Sider width={248} className="global-sider" trigger={null}>
        <Brand />
        <NavigationMenu page={route.page} onNavigate={navigateTo} />
        <div className="sider-footnote">
          <Cable size={15} />
          <span>2 engine adapters</span>
        </div>
      </Layout.Sider>

      <Layout className="global-workspace">
        <Layout.Header className="global-header">
          <div className="header-context">
            <Button
              className="mobile-menu-button"
              type="text"
              icon={<MenuIcon size={19} />}
              aria-label="Open navigation"
              onClick={() => setNavigationOpen(true)}
            />
            <div className="header-breadcrumb">
              <span>{route.section}</span>
              <strong>{route.title}</strong>
            </div>
          </div>
          <div className="header-actions">
            <div className="header-health">
              <HealthIndicator
                engine="Qdrant"
                fetching={qdrantHealth.isFetching}
                failed={qdrantHealth.isError}
                detail={qdrantMessage}
              />
              <HealthIndicator
                engine="Solr"
                fetching={solrHealth.isFetching}
                failed={solrHealth.isError}
                detail={solrMessage}
              />
            </div>
            <Tooltip title={`Refresh ${route.engine ?? "all engines"}`}>
              <Button
                type="text"
                icon={<RefreshCw size={17} />}
                aria-label="Refresh current view"
                onClick={refresh}
              />
            </Tooltip>
          </div>
        </Layout.Header>

        <Layout.Content className="global-content">
          <Suspense fallback={<PageLoading />}>
            <div className={`engine-module engine-module-${route.engine ?? "overview"}`}>
              {pageContent(route.page, navigateTo)}
            </div>
          </Suspense>
        </Layout.Content>
      </Layout>

      <Drawer
        placement="left"
        width={280}
        open={navigationOpen}
        onClose={() => setNavigationOpen(false)}
        closable={false}
        className="mobile-navigation"
        styles={{ body: { padding: 0 } }}
      >
        <Brand />
        <NavigationMenu page={route.page} onNavigate={navigateTo} />
      </Drawer>
    </Layout>
  );
};

export const RootApp = () => (
  <ConfigProvider
    theme={{
      token: {
        colorPrimary: "#2867d6",
        colorInfo: "#2867d6",
        colorBgLayout: "#f3f5f8",
        colorBorder: "#dce2ea",
        colorText: "#172033",
        borderRadius: 7,
        fontFamily:
          "Geist, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      },
      components: {
        Button: { controlHeight: 36 },
        Menu: { itemBorderRadius: 6 },
        Table: { headerBg: "#f5f7fa", headerColor: "#4b566b" },
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
