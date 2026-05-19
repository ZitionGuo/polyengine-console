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
});
