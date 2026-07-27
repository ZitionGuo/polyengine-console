export type EngineId = "qdrant" | "solr";

export interface EngineNavigationItem {
  key: AppPage;
  label: string;
  path: string;
  icon:
    | "aliases"
    | "cluster"
    | "collections"
    | "ingest"
    | "rest"
    | "search";
}

export interface EngineDefinition {
  id: EngineId;
  label: string;
  description: string;
  endpoint: string;
  apiPrefix: string;
  navigation: EngineNavigationItem[];
}

export type AppPage =
  | "overview"
  | "qdrant-collections"
  | "qdrant-aliases"
  | "qdrant-cluster"
  | "qdrant-rest"
  | "solr-collections"
  | "solr-search"
  | "solr-ingest";

export const engineRegistry: EngineDefinition[] = [
  {
    id: "qdrant",
    label: "Qdrant",
    description: "Vector database operations",
    endpoint: "http://localhost:6333",
    apiPrefix: "/api/qdrant",
    navigation: [
      {
        key: "qdrant-collections",
        label: "Collections",
        path: "/qdrant/collections",
        icon: "collections",
      },
      {
        key: "qdrant-aliases",
        label: "Aliases",
        path: "/qdrant/aliases",
        icon: "aliases",
      },
      {
        key: "qdrant-cluster",
        label: "Cluster",
        path: "/qdrant/cluster",
        icon: "cluster",
      },
      {
        key: "qdrant-rest",
        label: "REST Console",
        path: "/qdrant/rest",
        icon: "rest",
      },
    ],
  },
  {
    id: "solr",
    label: "Solr",
    description: "Semantic search workbench",
    endpoint: "http://localhost:8983",
    apiPrefix: "/api/solr",
    navigation: [
      {
        key: "solr-collections",
        label: "Collections",
        path: "/solr/collections",
        icon: "collections",
      },
      {
        key: "solr-search",
        label: "Vector Search",
        path: "/solr/search",
        icon: "search",
      },
      {
        key: "solr-ingest",
        label: "Ingest",
        path: "/solr/ingest",
        icon: "ingest",
      },
    ],
  },
];
