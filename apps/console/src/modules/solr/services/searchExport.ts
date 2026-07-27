import type { SearchPayload, SearchTimings } from "./api";
import type { QueryRequestPreview } from "./queryPreview";
import {
  documentJudgmentKey,
  relevanceStats,
  rankingMetrics,
  type RelevanceJudgments,
} from "./relevance";

export interface RankedResultSet {
  vector_field: string;
  documents: Array<Record<string, unknown>>;
}

export interface SearchExecutionMetadata extends QueryRequestPreview {
  target_mode: "single" | "compare" | "fuse";
  timings?: SearchTimings;
}

export interface SearchExportRow extends Record<string, unknown> {
  collection: string;
  query: string;
  mode: string;
  vector_field: string;
  rank: number;
  judgment: "relevant" | "irrelevant" | "unjudged";
  score: unknown;
}

const executionColumns = (execution?: SearchExecutionMetadata) => {
  if (!execution) return {};
  const request = execution.api_body;
  const vectorFields = "vector_fields" in request
    ? request.vector_fields
    : [request.vector_field];
  return {
    target_mode: execution.target_mode,
    endpoint: execution.endpoint,
    hybrid_strategy: request.hybrid_strategy,
    lexical_candidates: request.lexical_candidates,
    vector_candidates: request.vector_candidates,
    lexical_weight: request.lexical_weight,
    vector_weight: request.vector_weight,
    vector_fields: vectorFields,
    vector_weights: "vector_weights" in request ? request.vector_weights : undefined,
    vector_min_scores: "vector_min_scores" in request ? request.vector_min_scores : undefined,
    fusion_candidates: "fusion_candidates" in request ? request.fusion_candidates : undefined,
    rrf_k: "rrf_k" in request ? request.rrf_k : request.hybrid_rrf_k,
    timeout_ms: request.timeout_ms,
    minimum_score: request.min_score,
    total_ms: execution.timings?.total_ms,
    embedding_cache_hit: execution.timings?.embedding_cache_hit,
  };
};

export const buildSearchExportRows = (
  payload: SearchPayload,
  resultSets: RankedResultSet[],
  judgments: RelevanceJudgments,
  execution?: SearchExecutionMetadata,
): SearchExportRow[] =>
  resultSets.flatMap((resultSet) =>
    resultSet.documents.map((document, index) => {
      const { score, ...fields } = document;
      return {
        collection: payload.collection,
        query: payload.text,
        mode: payload.mode,
        ...executionColumns(execution),
        vector_field: resultSet.vector_field,
        rank: index + 1,
        judgment: judgments[documentJudgmentKey(document)] ?? "unjudged",
        score,
        ...fields,
      };
    }),
  );

const csvValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value) && value.every((item) => typeof item !== "object")) {
    return value.map(String).join(" | ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const csvCell = (value: unknown) => {
  const text = csvValue(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const searchExportRowsToCsv = (rows: SearchExportRow[]): string => {
  if (!rows.length) return "";
  const preferred = [
    "collection",
    "query",
    "mode",
    "target_mode",
    "endpoint",
    "hybrid_strategy",
    "lexical_candidates",
    "vector_candidates",
    "lexical_weight",
    "vector_weight",
    "vector_fields",
    "vector_weights",
    "vector_min_scores",
    "fusion_candidates",
    "rrf_k",
    "timeout_ms",
    "minimum_score",
    "vector_field",
    "rank",
    "judgment",
    "score",
    "total_ms",
    "embedding_cache_hit",
  ];
  const discovered = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const headers = [
    ...preferred.filter((key) => discovered.includes(key)),
    ...discovered.filter((key) => !preferred.includes(key)).sort(),
  ];
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
};

export const buildSearchEvaluationReport = (
  payload: SearchPayload,
  resultSets: RankedResultSet[],
  judgments: RelevanceJudgments,
  exportedAt = new Date().toISOString(),
  execution?: SearchExecutionMetadata,
) => {
  const uniqueDocuments = resultSets.flatMap((resultSet) => resultSet.documents);
  return {
    exported_at: exportedAt,
    query: payload,
    execution,
    evaluation: {
      overall: relevanceStats(uniqueDocuments, judgments),
      by_vector_field: Object.fromEntries(
        resultSets.map((resultSet) => [
          resultSet.vector_field,
          relevanceStats(resultSet.documents, judgments),
        ]),
      ),
      ranking_by_vector_field: Object.fromEntries(
        resultSets.map((resultSet) => [
          resultSet.vector_field,
          rankingMetrics(resultSet.documents, judgments),
        ]),
      ),
    },
    results: resultSets.map((resultSet) => ({
      vector_field: resultSet.vector_field,
      documents: resultSet.documents.map((document, index) => ({
        rank: index + 1,
        judgment: judgments[documentJudgmentKey(document)] ?? "unjudged",
        document,
      })),
    })),
  };
};

export const downloadTextFile = (filename: string, content: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const searchExportFilename = (collection: string, extension: "csv" | "json") => {
  const safeCollection = collection.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "collection";
  return `${safeCollection}-vector-search.${extension}`;
};
