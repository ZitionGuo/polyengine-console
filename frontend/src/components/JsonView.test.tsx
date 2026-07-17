import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import { afterEach, describe, expect, it, vi } from "vitest";

import { describeJsonValue, JsonView, stringifyJson } from "./JsonView";

describe("JsonView", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats JSON and describes the top-level value", () => {
    expect(stringifyJson({ result: { ok: true } })).toBe('{\n  "result": {\n    "ok": true\n  }\n}');
    expect(describeJsonValue([{ id: 1 }, { id: 2 }])).toEqual({
      kind: "Array",
      detail: "2 items",
    });
  });

  it("renders a light JSON panel with copy support", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(
      <AntApp>
        <JsonView data={{ status: "ok", result: { count: 2 } }} />
      </AntApp>,
    );

    expect(screen.getByText("Object")).toBeInTheDocument();
    expect(screen.getByText("2 keys")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('{\n  "status": "ok",\n  "result": {\n    "count": 2\n  }\n}');
    });
  });
});
