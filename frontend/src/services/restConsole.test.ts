import { describe, expect, it } from "vitest";

import { parseJsonBody, parseJsonObject, requiresConfirmation } from "./restConsole";

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
});
