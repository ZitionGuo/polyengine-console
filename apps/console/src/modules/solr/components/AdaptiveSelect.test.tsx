import { render, screen } from "@testing-library/react";

import { AdaptiveSelect } from "./AdaptiveSelect";

describe("AdaptiveSelect", () => {
  it("renders one available option as a read-only value", () => {
    render(
      <AdaptiveSelect
        value="solr_vector_demo_500"
        options={[{ label: "solr_vector_demo_500", value: "solr_vector_demo_500" }]}
      />,
    );

    expect(screen.getByRole("textbox", { name: "solr_vector_demo_500, only available option" })).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
