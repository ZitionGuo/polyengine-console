import { fireEvent, render, screen } from "@testing-library/react";

import { DocumentInspector, documentDisplayTitle } from "./DocumentInspector";

describe("DocumentInspector", () => {
  const document = {
    id: "doc-42",
    title: ["Backup recovery guide"],
    body: ["A readable long-form document body."],
    tags: ["backup", "recovery"],
    published: true,
    metadata: { owner: "search-team", priority: 3 },
    score: 0.812345,
  };

  it("renders common Solr field shapes without showing raw JSON by default", () => {
    render(<DocumentInspector document={document} open rank={2} vectorField="embedding" onClose={() => undefined} />);

    expect(screen.getAllByText("Backup recovery guide")).toHaveLength(2);
    expect(screen.getByText("Rank 2")).toBeVisible();
    expect(screen.getByText("Score 0.81234")).toBeVisible();
    expect(screen.getByText("A readable long-form document body.")).toBeVisible();
    expect(screen.getByText("backup")).toBeVisible();
    expect(screen.getByText("True")).toBeVisible();
    expect(screen.getByText("search-team")).toBeVisible();
    expect(screen.queryByText(/"doc-42"/)).not.toBeInTheDocument();
  });

  it("keeps raw JSON behind an explicit disclosure", () => {
    render(<DocumentInspector document={document} open onClose={() => undefined} />);

    fireEvent.click(screen.getByText("Raw document JSON"));

    expect(screen.getByText(/"id": "doc-42"/)).toBeVisible();
  });

  it("uses the first title value as the drawer heading", () => {
    expect(documentDisplayTitle(document)).toBe("Backup recovery guide");
  });

  it("uses the supplied score semantics", () => {
    render(
      <DocumentInspector
        document={document}
        open
        scoreLabel="RRF score"
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText("RRF score 0.81234")).toBeVisible();
  });
});
