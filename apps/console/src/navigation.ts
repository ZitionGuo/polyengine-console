import { engineRegistry, type AppPage, type EngineId } from "./engineRegistry";

export interface AppRoute {
  page: AppPage;
  path: string;
  title: string;
  engine: EngineId | null;
  section: string;
}

const routes: Record<AppPage, AppRoute> = {
  overview: {
    page: "overview",
    path: "/",
    title: "Overview",
    engine: null,
    section: "Workspace",
  },
  "qdrant-collections": {
    page: "qdrant-collections",
    path: "/qdrant/collections",
    title: "Collections",
    engine: "qdrant",
    section: "Qdrant",
  },
  "qdrant-aliases": {
    page: "qdrant-aliases",
    path: "/qdrant/aliases",
    title: "Aliases",
    engine: "qdrant",
    section: "Qdrant",
  },
  "qdrant-cluster": {
    page: "qdrant-cluster",
    path: "/qdrant/cluster",
    title: "Cluster",
    engine: "qdrant",
    section: "Qdrant",
  },
  "qdrant-rest": {
    page: "qdrant-rest",
    path: "/qdrant/rest",
    title: "REST Console",
    engine: "qdrant",
    section: "Qdrant",
  },
  "solr-collections": {
    page: "solr-collections",
    path: "/solr/collections",
    title: "Collections",
    engine: "solr",
    section: "Solr",
  },
  "solr-search": {
    page: "solr-search",
    path: "/solr/search",
    title: "Vector Search",
    engine: "solr",
    section: "Solr",
  },
  "solr-ingest": {
    page: "solr-ingest",
    path: "/solr/ingest",
    title: "Ingest",
    engine: "solr",
    section: "Solr",
  },
};

const legacyRoutes: Record<string, AppPage> = {
  "/collections": "qdrant-collections",
  "/aliases": "qdrant-aliases",
  "/cluster": "qdrant-cluster",
  "/rest": "qdrant-rest",
  "/search": "solr-search",
  "/ingest": "solr-ingest",
};

const normalizePath = (pathname: string) => {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized || "/";
};

export const routeForPage = (page: AppPage) => routes[page];

export const resolveAppRoute = (
  pathname: string,
): { route: AppRoute; canonicalPath: string } => {
  const normalized = normalizePath(pathname);
  const legacyPage = legacyRoutes[normalized];
  if (legacyPage) {
    const route = routes[legacyPage];
    return { route, canonicalPath: route.path };
  }

  const legacyCollection = normalized.match(/^\/collections\/([^/]+)$/);
  if (legacyCollection) {
    return {
      route: routes["qdrant-collections"],
      canonicalPath: `/qdrant/collections/${legacyCollection[1]}`,
    };
  }

  if (/^\/qdrant\/collections\/[^/]+$/.test(normalized)) {
    return {
      route: routes["qdrant-collections"],
      canonicalPath: normalized,
    };
  }

  const exact = Object.values(routes).find((route) => route.path === normalized);
  if (exact) return { route: exact, canonicalPath: exact.path };

  const registered = engineRegistry
    .flatMap((engine) => engine.navigation)
    .find((item) => item.path === normalized);
  if (registered) {
    const route = routes[registered.key];
    return { route, canonicalPath: route.path };
  }

  return { route: routes.overview, canonicalPath: "/" };
};

export const documentTitle = (route: AppRoute) =>
  route.page === "overview"
    ? "PolyEngine Console"
    : `${route.title} · ${route.section} · PolyEngine Console`;
