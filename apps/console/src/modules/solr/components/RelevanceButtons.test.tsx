import { fireEvent, render, screen } from "@testing-library/react";

import { RelevanceButtons } from "./RelevanceButtons";

describe("RelevanceButtons", () => {
  it("marks and clears a relevant judgment", () => {
    const onChange = vi.fn();
    const { rerender } = render(<RelevanceButtons label="Document one" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark relevant Document one" }));
    expect(onChange).toHaveBeenLastCalledWith("relevant");

    rerender(<RelevanceButtons label="Document one" value="relevant" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear relevant judgment for Document one" }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("marks a document as not relevant", () => {
    const onChange = vi.fn();
    render(<RelevanceButtons label="Document one" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark not relevant Document one" }));
    expect(onChange).toHaveBeenCalledWith("irrelevant");
  });
});
