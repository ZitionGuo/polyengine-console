export type PageKey = "collections" | "search" | "ingest";

export const pageFromPath = (path: string): PageKey => {
  if (path.startsWith("/solr/ingest")) return "ingest";
  if (path.startsWith("/solr/search")) return "search";
  return "collections";
};

export const pagePath = (page: PageKey) => `/solr/${page}`;

export const selectCollection = (collection: string) => {
  window.localStorage.setItem("solr-vector-selected-collection", collection);
};

export const selectedCollection = () => window.localStorage.getItem("solr-vector-selected-collection") ?? "";
