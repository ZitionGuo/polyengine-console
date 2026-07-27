export type PageKey = "collections" | "aliases" | "cluster" | "rest";

export const pagePaths: Record<PageKey, string> = {
  collections: "/qdrant/collections",
  aliases: "/qdrant/aliases",
  cluster: "/qdrant/cluster",
  rest: "/qdrant/rest",
};

export const pageTitles: Record<PageKey, string> = {
  collections: "Collections",
  aliases: "Aliases",
  cluster: "Cluster",
  rest: "REST Console",
};

const normalizePath = (pathname: string) => {
  const withoutTrailingSlash = pathname.replace(/\/+$/, "");
  return withoutTrailingSlash || "/";
};

export const getCollectionNameFromPath = (pathname: string): string | null => {
  const normalized = normalizePath(pathname);
  const match = normalized.match(/^\/qdrant\/collections\/([^/]+)$/);
  if (!match) return null;

  try {
    const collectionName = decodeURIComponent(match[1]);
    return collectionName || null;
  } catch {
    return null;
  }
};

export const getPageFromPath = (pathname: string): PageKey | null => {
  const normalized = normalizePath(pathname);
  if (getCollectionNameFromPath(normalized)) return "collections";
  const match = (Object.entries(pagePaths) as Array<[PageKey, string]>).find(
    ([, path]) => path === normalized,
  );
  return match?.[0] ?? null;
};

export const getPagePath = (page: PageKey) => pagePaths[page];

export const getCollectionPath = (collectionName: string) =>
  `${pagePaths.collections}/${encodeURIComponent(collectionName)}`;

export const getPageDocumentTitle = (page: PageKey) =>
  `${pageTitles[page]} · Qdrant · PolyEngine Console`;
