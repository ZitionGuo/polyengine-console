import { describe, expect, it } from "vitest";

import {
  parseJsonBody,
  parseJsonObject,
  requiresConfirmation,
  restTemplates,
  summarizeResponse,
} from "./restConsole";

describe("restConsole helpers", () => {
  it("requires confirmation for mutating methods", () => {
    expect(requiresConfirmation("GET")).toBe(false);
    expect(requiresConfirmation("POST")).toBe(true);
    expect(requiresConfirmation("put")).toBe(true);
    expect(requiresConfirmation("DELETE")).toBe(true);
  });

  it("parses query objects and arbitrary JSON bodies", () => {
    expect(parseJsonObject('{"limit":5}', "Query")).toEqual({ limit: 5 });
    expect(parseJsonBody("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("includes Qdrant request templates for common console operations", () => {
    const upsertTemplate = restTemplates.find((template) => template.key === "upsert-points");
    const retrieveTemplate = restTemplates.find((template) => template.key === "retrieve-points");
    const queryTemplate = restTemplates.find((template) => template.key === "query-points");
    const filterTemplate = restTemplates.find((template) => template.key === "filter-points");

    expect(restTemplates.map((template) => template.key)).toContain("list-collections");
    expect(upsertTemplate).toMatchObject({
      method: "PUT",
      path: "/collections/my_collection/points",
    });
    expect(parseJsonObject(upsertTemplate?.queryText ?? "", "Query")).toEqual({ wait: true });
    expect(parseJsonBody(upsertTemplate?.bodyText ?? "")).toMatchObject({
      points: [{ id: 1 }],
    });
    expect(retrieveTemplate).toMatchObject({
      method: "POST",
      path: "/collections/my_collection/points",
    });
    expect(parseJsonBody(retrieveTemplate?.bodyText ?? "")).toEqual({
      ids: [1],
      with_payload: true,
      with_vector: false,
    });
    expect(queryTemplate).toMatchObject({
      method: "POST",
      path: "/collections/my_collection/points/query",
    });
    expect(parseJsonBody(queryTemplate?.bodyText ?? "")).toMatchObject({
      query: [0.1, 0.2, 0.3, 0.4],
    });
    expect(parseJsonBody(filterTemplate?.bodyText ?? "")).toMatchObject({
      filter: { must: [{ key: "metadata.source" }] },
    });
  });

  it("summarizes Qdrant response envelopes", () => {
    expect(
      summarizeResponse({
        result: { collections: [{ name: "docs" }, { name: "images" }] },
        status: "ok",
        time: 0.003,
      }),
    ).toEqual({
      status: "ok",
      statusCode: null,
      time: "3.00 ms",
      result: "2 collections",
    });
  });

  it("summarizes retrieve point arrays as points", () => {
    expect(
      summarizeResponse({
        result: [{ id: 1, payload: { source: "manual" } }],
        status: "ok",
      }),
    ).toMatchObject({
      status: "ok",
      result: "1 point",
    });
  });

  it("summarizes REST proxy metadata separately from the Qdrant body", () => {
    expect(
      summarizeResponse({
        status_code: 202,
        headers: { "content-type": "application/json" },
        duration_ms: 4.125,
        body: { result: true, status: "ok", time: 0.001 },
      }),
    ).toEqual({
      status: "ok",
      statusCode: 202,
      time: "4.13 ms",
      result: "True",
    });

    expect(
      summarizeResponse({
        status_code: 404,
        headers: {},
        duration_ms: null,
        body: { detail: { message: "Not found" } },
      }),
    ).toMatchObject({
      status: "error",
      statusCode: 404,
      time: "n/a",
    });
  });
});
