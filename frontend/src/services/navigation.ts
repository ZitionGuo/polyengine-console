export type PageKey = "collections" | "aliases" | "cluster" | "rest";

export const pagePaths: Record<PageKey, string> = {
  collections: "/collections",
  aliases: "/aliases",
  cluster: "/cluster",
  rest: "/rest",
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

export const getPageFromPath = (pathname: string): PageKey | null => {
  const normalized = normalizePath(pathname);
  if (normalized === "/") return "collections";
  const match = (Object.entries(pagePaths) as Array<[PageKey, string]>).find(
    ([, path]) => path === normalized,
  );
  return match?.[0] ?? null;
};

export const getPagePath = (page: PageKey) => pagePaths[page];

export const getPageDocumentTitle = (page: PageKey) =>
  `${pageTitles[page]} · Qdrant Local Admin`;
