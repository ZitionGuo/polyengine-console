import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";

describe("api service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts alias mutations to the backend alias API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.createAlias("docs", "docs_live");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/aliases",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ collection_name: "docs", alias_name: "docs_live" }),
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
});
