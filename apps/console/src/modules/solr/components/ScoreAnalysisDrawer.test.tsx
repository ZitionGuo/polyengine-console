import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { ScoreAnalysisDrawer } from "./ScoreAnalysisDrawer";

const profile = {
  vector_field: "embedding",
  count: 5,
  minimum: 0.6,
  lower_quartile: 0.65,
  median: 0.7,
  upper_quartile: 0.9,
  maximum: 0.95,
  largest_gap_cutoff: 0.8,
  scores: [0.95, 0.9, 0.7, 0.65, 0.6],
};

describe("ScoreAnalysisDrawer", () => {
  it("applies a data-driven threshold preset", async () => {
    const onApplyThreshold = vi.fn();
    render(
      <ScoreAnalysisDrawer
        open
        profiles={[profile]}
        thresholds={{}}
        onApplyThreshold={onApplyThreshold}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Set threshold" }));
    fireEvent.click(await screen.findByText("Keep top 50% · 0.7000"));

    expect(onApplyThreshold).toHaveBeenCalledWith("embedding", 0.7);
  });
});
