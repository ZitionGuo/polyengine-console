import type { CompareSearchPayload, FuseSearchPayload, SearchPayload } from "./api";

export interface SolrRequestPreview {
  vector_field: string;
  method: "POST";
  path: string;
  params: Record<string, string | number | string[]>;
}

export interface QueryRequestPreview {
  endpoint: "/api/search" | "/api/search/compare" | "/api/search/fuse";
  api_body: SearchPayload | CompareSearchPayload | FuseSearchPayload;
  solr_requests: SolrRequestPreview[];
}

const vectorPlaceholder = "<384-dimensional-query-vector>";

const vectorQuery = (
  payload: SearchPayload,
  vectorField: string,
  topK: number,
  preFilter = false,
  minScore: number | null = payload.min_score,
) => {
  const filterParam = preFilter ? " preFilter=$knnFilter" : "";
  return minScore == null
    ? `{!knn f=${vectorField} topK=${topK}${filterParam}}${vectorPlaceholder}`
    : `{!vectorSimilarity f=${vectorField} minReturn=${minScore}${filterParam}}${vectorPlaceholder}`;
};

const solrParams = (
  payload: SearchPayload,
  vectorField: string,
  minScore: number | null = payload.min_score,
): SolrRequestPreview["params"] => {
  const fields = [...new Set([...payload.return_fields, "score"])];
  const params: SolrRequestPreview["params"] = {
    rows: payload.limit,
    fl: payload.return_fields.length ? fields.join(",") : "*,score",
    timeAllowed: payload.timeout_ms ?? 15_000,
    wt: "json",
    echoParams: "none",
  };

  if (payload.mode === "semantic") {
    params.q = vectorQuery(payload, vectorField, payload.limit, false, minScore);
  } else {
    const vectorCandidates = Math.max(payload.vector_candidates, payload.limit);
    const rerankDocs = Math.max(payload.rerank_docs, payload.limit);
    params.q = payload.text;
    params.defType = "edismax";
    params.qf = payload.lexical_fields
      .map((field) => `${field}^${payload.lexical_boosts[field] ?? 1}`)
      .join(" ");
    params.rq = `{!rerank reRankQuery=$rqq reRankDocs=${rerankDocs} reRankWeight=${payload.rerank_weight}}`;
    params.rqq = vectorQuery(
      payload,
      vectorField,
      vectorCandidates,
      Boolean(payload.filters.length),
      minScore,
    );
  }
  if (payload.filters.length) {
    params.fq = payload.filters;
    if (payload.mode === "hybrid") params.knnFilter = payload.filters;
  }
  return params;
};

const lexicalParams = (
  payload: SearchPayload,
): SolrRequestPreview["params"] => {
  const fields = [...new Set([...payload.return_fields, "score"])];
  const params: SolrRequestPreview["params"] = {
    q: payload.text,
    defType: "edismax",
    qf: payload.lexical_fields
      .map((field) => `${field}^${payload.lexical_boosts[field] ?? 1}`)
      .join(" "),
    rows: Math.max(payload.limit, payload.lexical_candidates),
    fl: payload.return_fields.length ? fields.join(",") : "*,score",
    timeAllowed: payload.timeout_ms ?? 15_000,
    wt: "json",
    echoParams: "none",
  };
  if (payload.filters.length) params.fq = payload.filters;
  return params;
};

export const buildQueryRequestPreview = (
  payload: SearchPayload,
  vectorFields: string[],
  targetMode: "single" | "compare" | "fuse" = vectorFields.length > 1 ? "compare" : "single",
  fusion?: {
    vectorWeights: Record<string, number>;
    vectorMinScores?: Record<string, number | null>;
    fusionCandidates: number;
    rrfK: number;
  },
): QueryRequestPreview => {
  const fields = [...new Set(vectorFields.length ? vectorFields : [payload.vector_field])];
  let apiBody: SearchPayload | CompareSearchPayload | FuseSearchPayload = payload;
  if (targetMode !== "single") {
    const { vector_field: _vectorField, ...shared } = payload;
    apiBody = targetMode === "fuse"
      ? {
        ...shared,
        min_score: null,
        vector_fields: fields,
        vector_min_scores: Object.fromEntries(
          fields.flatMap((field) => {
            const score = fusion?.vectorMinScores?.[field];
            return score === null || score === undefined ? [] : [[field, score]];
          }),
        ),
        vector_weights: Object.fromEntries(fields.map((field) => [field, fusion?.vectorWeights[field] ?? 1])),
        fusion_candidates: Math.max(payload.limit, fusion?.fusionCandidates ?? 50),
        rrf_k: fusion?.rrfK ?? 60,
      }
      : {
        ...shared,
        min_score: null,
        vector_fields: fields,
        vector_min_scores: Object.fromEntries(
          fields.flatMap((field) => {
            const score = fusion?.vectorMinScores?.[field];
            return score === null || score === undefined ? [] : [[field, score]];
          }),
        ),
      };
  }
  const executionPayload = targetMode === "fuse"
    ? {
      ...payload,
      limit: Math.max(payload.limit, fusion?.fusionCandidates ?? 50),
      vector_candidates: Math.max(payload.vector_candidates, fusion?.fusionCandidates ?? 50),
      rerank_docs: Math.max(payload.rerank_docs, fusion?.fusionCandidates ?? 50),
    }
    : payload;
  const rrfHybrid = payload.mode === "hybrid" && payload.hybrid_strategy === "rrf";
  const vectorExecutionPayload: SearchPayload = rrfHybrid
    ? {
      ...executionPayload,
      mode: "semantic",
      limit: targetMode === "fuse"
        ? executionPayload.limit
        : Math.max(payload.limit, payload.vector_candidates),
    }
    : executionPayload;
  const path = `/${encodeURIComponent(payload.collection)}/select`;
  const activeVectorFields = targetMode === "fuse"
    ? fields.filter((field) => (fusion?.vectorWeights[field] ?? 1) > 0)
    : rrfHybrid && payload.vector_weight <= 0 ? [] : fields;
  const vectorRequests = activeVectorFields.map((vectorField) => ({
    vector_field: vectorField,
    method: "POST" as const,
    path,
    params: solrParams(
      vectorExecutionPayload,
      vectorField,
      targetMode === "single" ? payload.min_score : fusion?.vectorMinScores?.[vectorField] ?? null,
    ),
  }));
  return {
    endpoint: targetMode === "fuse"
      ? "/api/search/fuse"
      : targetMode === "compare" ? "/api/search/compare" : "/api/search",
    api_body: apiBody,
    solr_requests: rrfHybrid
      ? [
        ...vectorRequests,
        ...(payload.lexical_weight > 0 ? [{
          vector_field: "BM25",
          method: "POST" as const,
          path,
          params: lexicalParams(payload),
        }] : []),
      ]
      : vectorRequests,
  };
};
