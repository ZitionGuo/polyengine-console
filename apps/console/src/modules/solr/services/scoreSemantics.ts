export interface ScoreSemantics {
  label: "Similarity" | "Hybrid score" | "RRF score";
  help: string;
}

export const scoreSemantics = (
  targetMode: "single" | "compare" | "fuse",
  searchMode: "semantic" | "hybrid",
  hybridStrategy: "rerank" | "rrf" = "rerank",
): ScoreSemantics => {
  if (targetMode === "fuse" || (searchMode === "hybrid" && hybridStrategy === "rrf")) {
    return {
      label: "RRF score",
      help: "A rank-fusion score. Similarity thresholds use the per-field source scores shown beside each document.",
    };
  }
  if (searchMode === "hybrid") {
    return {
      label: "Hybrid score",
      help: "Solr combines the lexical BM25 score with the vector rerank contribution.",
    };
  }
  return {
    label: "Similarity",
    help: "The similarity score returned by the selected Solr vector field.",
  };
};

export const supportsSimilarityAnalysis = (
  searchMode: "semantic" | "hybrid" | undefined,
): boolean => searchMode === "semantic";
