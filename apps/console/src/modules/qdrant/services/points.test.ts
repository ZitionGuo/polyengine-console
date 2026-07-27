import { describe, expect, it } from "vitest";

import {
  buildPointCountPayload,
  buildPointFacetPayload,
  buildPointQueryPayload,
  buildPointRetrievePayload,
  buildPointScrollPayload,
  hasPointFilter,
  normalizePointFilterJson,
  parsePointPayloadInput,
  parsePointIdsInput,
  parseUpsertPointsInput,
} from "./points";

describe("points helpers", () => {
  it("parses point arrays and Qdrant-style points envelopes", () => {
    expect(parseUpsertPointsInput('[{"id":1,"vector":[0.1],"payload":{"source":"manual"}}]')).toEqual([
      { id: 1, vector: [0.1], payload: { source: "manual" } },
    ]);
    expect(parseUpsertPointsInput('{"points":[{"id":"a","vector":[0.2]}]}')).toEqual([
      { id: "a", vector: [0.2] },
    ]);
  });

  it("rejects empty or non-object point input", () => {
    expect(() => parseUpsertPointsInput("[]")).toThrow(/non-empty/);
    expect(() => parseUpsertPointsInput("[1]")).toThrow(/JSON object/);
  });

  it("parses point id arrays and Qdrant-style id envelopes", () => {
    expect(parsePointIdsInput("[1,\"abc\"]")).toEqual([1, "abc"]);
    expect(parsePointIdsInput('{"ids":["uuid-value"]}')).toEqual(["uuid-value"]);
  });

  it("builds retrieve point payloads", () => {
    expect(buildPointRetrievePayload({ idsText: "[1,2]", withVector: true })).toEqual({
      ids: [1, 2],
      with_payload: true,
      with_vector: true,
    });
    expect(() => buildPointRetrievePayload({ idsText: "[]" })).toThrow(/non-empty/);
  });

  it("builds filtered point scroll payloads", () => {
    expect(
      buildPointScrollPayload({
        limit: 20,
        offset: 10,
        filterText: '{"must":[{"key":"group","match":{"value":"a"}}]}',
      }),
    ).toEqual({
      limit: 20,
      offset: 10,
      filter: { must: [{ key: "group", match: { value: "a" } }] },
      with_payload: true,
      with_vector: false,
    });
  });

  it("normalizes and detects empty point filters", () => {
    expect(hasPointFilter("{}")).toBe(false);
    expect(hasPointFilter('{"must":[]}')).toBe(true);
    expect(normalizePointFilterJson('{"must":[]}')).toBe('{\n  "must": []\n}');
    expect(() => buildPointScrollPayload({ filterText: "[]" })).toThrow(/Filter must be a JSON object/);
  });

  it("parses point payload objects", () => {
    expect(parsePointPayloadInput('{"source":"edited","active":true}')).toEqual({
      source: "edited",
      active: true,
    });
    expect(parsePointPayloadInput("")).toEqual({});
    expect(() => parsePointPayloadInput("[]")).toThrow(/Payload must be a JSON object/);
  });

  it("builds point query payloads with optional filter and vector name", () => {
    expect(
      buildPointQueryPayload({
        queryText: "[1,0,0,0]",
        filterText: '{"must":[{"key":"group","match":{"value":"a"}}]}',
        using: "dense",
        limit: 3,
        withVector: true,
      }),
    ).toEqual({
      query: [1, 0, 0, 0],
      filter: { must: [{ key: "group", match: { value: "a" } }] },
      using: "dense",
      limit: 3,
      with_payload: true,
      with_vector: true,
    });
  });

  it("builds count and facet payloads from the active filter", () => {
    const filterText = '{"must":[{"key":"group","match":{"value":"a"}}]}';
    expect(buildPointCountPayload({ filterText })).toEqual({
      filter: { must: [{ key: "group", match: { value: "a" } }] },
      exact: true,
    });
    expect(
      buildPointFacetPayload({
        key: " source.type ",
        limit: 25,
        filterText,
        exact: true,
      }),
    ).toEqual({
      key: "source.type",
      limit: 25,
      filter: { must: [{ key: "group", match: { value: "a" } }] },
      exact: true,
    });
    expect(buildPointCountPayload({})).toEqual({ exact: true });
  });

  it("rejects invalid facet input", () => {
    expect(() => buildPointFacetPayload({ key: "   " })).toThrow(/required/);
    expect(() => buildPointFacetPayload({ key: "group", limit: 0 })).toThrow(/between 1 and 100/);
    expect(() => buildPointFacetPayload({ key: "group", limit: 1.5 })).toThrow(/integer/);
  });

  it("rejects invalid point query input", () => {
    expect(() =>
      buildPointQueryPayload({
        queryText: "",
        filterText: "{}",
      }),
    ).toThrow(/required/);
    expect(() =>
      buildPointQueryPayload({
        queryText: "[1,0]",
        filterText: "[]",
      }),
    ).toThrow(/Filter must be a JSON object/);
  });
});
