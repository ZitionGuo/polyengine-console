import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";

describe("api service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the detailed collection overview without changing the base list endpoint", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: "ok", result: { collections: [] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.listCollections();
    await api.listCollectionOverview();

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/collections", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/collections?include_details=true",
      expect.any(Object),
    );
  });

  it("posts alias create and update mutations to the backend alias API", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.createAlias("docs", "docs_live");
    await api.updateAlias("docs/live", {
      new_alias_name: "docs_current",
      collection_name: "docs_v2",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/aliases",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ collection_name: "docs", alias_name: "docs_live" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/aliases/docs%2Flive",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          new_alias_name: "docs_current",
          collection_name: "docs_v2",
        }),
      }),
    );
  });

  it("calls payload index create and delete endpoints", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));
    vi.stubGlobal("fetch", fetchMock);

    await api.createIndex("docs", "metadata.source", { type: "keyword", on_disk: true });
    await api.deleteIndex("docs", "metadata.source");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/collections/docs/indexes",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          field_name: "metadata.source",
          field_schema: { type: "keyword", on_disk: true },
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/collections/docs/indexes/metadata.source",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("builds snapshot download URLs and loads optimization progress", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok", result: { running: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(api.collectionSnapshotDownloadUrl("docs 2026", "nightly #1.snapshot")).toBe(
      "/api/collections/docs%202026/snapshots/nightly%20%231.snapshot",
    );
    await api.getCollectionOptimizations("docs 2026", 5);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/collections/docs%202026/optimizations?completed_limit=5",
      expect.any(Object),
    );
  });

  it("uploads snapshot FormData without overriding the multipart content type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok", result: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const snapshot = new File(["snapshot-data"], "backup.snapshot", {
      type: "application/octet-stream",
    });

    await api.uploadCollectionSnapshot("docs copy", snapshot, {
      priority: "snapshot",
      checksum: "a".repeat(64),
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `/api/collections/docs%20copy/snapshots/upload?wait=true&priority=snapshot&checksum=${"a".repeat(64)}`,
    );
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({});
    expect(init.body).toBeInstanceOf(FormData);
    const uploaded = (init.body as FormData).get("snapshot") as File;
    expect(uploaded.name).toBe(snapshot.name);
    expect(uploaded.size).toBe(snapshot.size);
    expect(uploaded.type).toBe(snapshot.type);
  });

  it("calls full storage snapshot endpoints with encoded download and delete URLs", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: "ok", result: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.listStorageSnapshots();
    await api.createStorageSnapshot();
    expect(api.storageSnapshotDownloadUrl("full backup #1.snapshot")).toBe(
      "/api/snapshots/full%20backup%20%231.snapshot",
    );
    await api.deleteStorageSnapshot("full backup #1.snapshot");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/snapshots", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/snapshots?wait=true",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/snapshots/full%20backup%20%231.snapshot?wait=true",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("calls the points scroll endpoint", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ status: "ok", result: { points: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));
    vi.stubGlobal("fetch", fetchMock);

    await api.scrollPoints("docs", {
      limit: 25,
      offset: 10,
      with_payload: true,
      with_vector: false,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/collections/docs/points/scroll",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          limit: 25,
          offset: 10,
          with_payload: true,
          with_vector: false,
        }),
      }),
    );
  });

  it("calls the points query endpoint", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ status: "ok", result: { points: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));
    vi.stubGlobal("fetch", fetchMock);

    await api.queryPoints("docs", {
      query: [0.1, 0.2],
      using: "dense",
      limit: 5,
      with_payload: true,
      with_vector: false,
      filter: { must: [{ key: "source", match: { value: "manual" } }] },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/collections/docs/points/query",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          query: [0.1, 0.2],
          using: "dense",
          limit: 5,
          with_payload: true,
          with_vector: false,
          filter: { must: [{ key: "source", match: { value: "manual" } }] },
        }),
      }),
    );
  });

  it("calls the points retrieve endpoint", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ status: "ok", result: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));
    vi.stubGlobal("fetch", fetchMock);

    await api.retrievePoints("docs", {
      ids: [1, "abc"],
      with_payload: true,
      with_vector: false,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/collections/docs/points/retrieve",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          ids: [1, "abc"],
          with_payload: true,
          with_vector: false,
        }),
      }),
    );
  });

  it("calls point count and facet endpoints with encoded collection names", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: "ok", result: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const filter = { must: [{ key: "group", match: { value: "a" } }] };

    await api.countPoints("docs copy", { filter, exact: true });
    await api.facetPoints("docs copy", {
      key: "source.type",
      limit: 25,
      filter,
      exact: false,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/collections/docs%20copy/points/count",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ filter, exact: true }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/collections/docs%20copy/points/facet",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          key: "source.type",
          limit: 25,
          filter,
          exact: false,
        }),
      }),
    );
  });

  it("calls the points delete endpoint with wait as query parameter", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));
    vi.stubGlobal("fetch", fetchMock);

    await api.deletePoints("docs", {
      points: [1, "abc"],
      wait: true,
      ordering: "strong",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/collections/docs/points/delete?wait=true&ordering=strong",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ points: [1, "abc"] }),
      }),
    );
  });

  it("calls the points upsert endpoint with points in the request body", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));
    vi.stubGlobal("fetch", fetchMock);

    await api.upsertPoints("docs", {
      points: [{ id: 1, vector: [0.1, 0.2], payload: { source: "manual" } }],
      wait: true,
      ordering: "medium",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/collections/docs/points?wait=true&ordering=medium",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          points: [{ id: 1, vector: [0.1, 0.2], payload: { source: "manual" } }],
        }),
      }),
    );
  });

  it("calls point payload overwrite and clear endpoints", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.overwritePointPayload("docs", {
      pointId: "point-1",
      payload: { source: "edited" },
      wait: true,
      ordering: "medium",
    });
    await api.clearPointPayload("docs", { pointId: "point-1", wait: true });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/collections/docs/points/payload?wait=true&ordering=medium",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          points: ["point-1"],
          payload: { source: "edited" },
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/collections/docs/points/payload/clear?wait=true",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ points: ["point-1"] }),
      }),
    );
  });
});
