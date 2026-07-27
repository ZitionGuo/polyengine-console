import { describe, expect, it } from "vitest";

import { documentTitle, resolveAppRoute, routeForPage } from "./navigation";

describe("application navigation", () => {
  it("uses the overview as the default workspace", () => {
    expect(resolveAppRoute("/").route.page).toBe("overview");
    expect(resolveAppRoute("/missing").canonicalPath).toBe("/");
  });

  it("maps engine routes and collection detail paths", () => {
    expect(resolveAppRoute("/qdrant/aliases").route.page).toBe("qdrant-aliases");
    expect(resolveAppRoute("/solr/search").route.page).toBe("solr-search");
    expect(resolveAppRoute("/qdrant/collections/docs").route.page).toBe(
      "qdrant-collections",
    );
  });

  it("redirects legacy routes without losing a collection name", () => {
    expect(resolveAppRoute("/collections").canonicalPath).toBe(
      "/qdrant/collections",
    );
    expect(resolveAppRoute("/collections/docs%20live").canonicalPath).toBe(
      "/qdrant/collections/docs%20live",
    );
    expect(resolveAppRoute("/search").canonicalPath).toBe("/solr/search");
  });

  it("provides stable routes and product document titles", () => {
    const route = routeForPage("solr-ingest");
    expect(route.path).toBe("/solr/ingest");
    expect(documentTitle(route)).toBe(
      "Ingest · Solr · PolyEngine Console",
    );
  });
});
