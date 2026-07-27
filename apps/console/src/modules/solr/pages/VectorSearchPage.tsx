import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Collapse,
  Descriptions,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Popconfirm,
  Popover,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  BarChart3,
  CircleHelp,
  CircleStop,
  Combine,
  Eye,
  Download,
  GitCompareArrows,
  History as HistoryIcon,
  FileSearch,
  Gauge,
  Plus,
  RotateCcw,
  Search,
  TimerReset,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AdaptiveSelect } from "../components/AdaptiveSelect";
import { DocumentInspector, documentDisplayTitle } from "../components/DocumentInspector";
import { PageHeader } from "../components/PageHeader";
import { QueryInspector } from "../components/QueryInspector";
import { RelevanceButtons } from "../components/RelevanceButtons";
import { ScoreAnalysisDrawer } from "../components/ScoreAnalysisDrawer";
import {
  api,
  errorMessage,
  type SchemaField,
  type CompareSearchPayload,
  type FuseSearchPayload,
  type SearchPayload,
  type SearchResult,
  type SearchTimings,
} from "../services/api";
import {
  buildCompareSearchPayload,
  buildFuseSearchPayload,
  comparisonOverlap,
  fusionFieldDiagnostics,
  MAX_MULTI_VECTOR_FIELDS,
  sourceReturnedCount,
} from "../services/comparison";
import {
  buildFilterQuery,
  filterKind,
  filterRuleComplete,
  operatorsForField,
  type FilterRule,
} from "../services/filters";
import { selectedCollection } from "../services/navigation";
import {
  clearRelevanceJudgments,
  documentJudgmentKey,
  loadRelevanceJudgments,
  rankingMetrics,
  relevanceContext,
  relevanceStats,
  updateRelevanceJudgment,
  type RankingMetrics,
  type RelevanceJudgments,
} from "../services/relevance";
import { buildQueryRequestPreview } from "../services/queryPreview";
import { LatestRequestCoordinator } from "../services/requestCoordinator";
import {
  buildSearchEvaluationReport,
  buildSearchExportRows,
  downloadTextFile,
  searchExportFilename,
  searchExportRowsToCsv,
  type RankedResultSet,
  type SearchExecutionMetadata,
} from "../services/searchExport";
import { buildScoreProfiles } from "../services/scoreProfile";
import { scoreSemantics, supportsSimilarityAnalysis } from "../services/scoreSemantics";
import {
  buildSearchPayload,
  clearSearchHistory,
  loadSearchHistory,
  removeSearchHistory,
  saveSearchHistory,
  searchPayloadToFormValues,
  type SearchFormValues,
  type SearchHistoryEntry,
} from "../services/searchPayload";
import { summarizeSolrValue } from "../services/solrValue";
import { clearSelectedThresholds, hasSelectedThreshold } from "../services/thresholds";

const docsFromResult = (result?: SearchResult) => result?.response.response?.docs ?? [];

let nextFilterRuleId = 0;
const createFilterRule = (field: string): FilterRule => ({
  id: `filter-${Date.now()}-${nextFilterRuleId += 1}`,
  field,
  operator: "equals",
  value: "",
  secondValue: "",
});

interface FilterValueInputProps {
  rule: FilterRule;
  field?: SchemaField;
  onChange: (changes: Partial<FilterRule>) => void;
}

const FilterValueInput = ({ rule, field, onChange }: FilterValueInputProps) => {
  const kind = filterKind(field);
  if (rule.operator === "exists") {
    return <Input value="Any value" disabled aria-label={`${rule.field} exists`} />;
  }

  const input = (value: string, key: "value" | "secondValue", label: string) => {
    if (kind === "boolean") {
      return (
        <Select
          value={value || undefined}
          options={[
            { label: "True", value: "true" },
            { label: "False", value: "false" },
          ]}
          onChange={(next) => onChange({ [key]: next })}
          placeholder="Select value"
          aria-label={label}
        />
      );
    }
    if (kind === "number") {
      return (
        <InputNumber
          value={value === "" ? null : Number(value)}
          onChange={(next) => onChange({ [key]: next === null ? "" : String(next) })}
          className="full-width"
          placeholder="Value"
          aria-label={label}
        />
      );
    }
    return (
      <Input
        value={value}
        onChange={(event) => onChange({ [key]: event.target.value })}
        placeholder={kind === "date" ? "2026-01-01T00:00:00Z" : "Value"}
        aria-label={label}
      />
    );
  };

  if (rule.operator === "between") {
    return (
      <div className="filter-between">
        {input(rule.value, "value", `${rule.field} minimum`)}
        <Typography.Text type="secondary">to</Typography.Text>
        {input(rule.secondValue, "secondValue", `${rule.field} maximum`)}
      </div>
    );
  }
  return input(rule.value, "value", `${rule.field} filter value`);
};

const documentSubtitle = (document: Record<string, unknown>) =>
  [document.id, document.category]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(Array.isArray(value) ? value[0] : value))
    .join(" · ");

const textFieldPriority = (field: SchemaField) => {
  if (field.name.startsWith("_")) return -100;
  return (field.class?.includes("TextField") ? 20 : 0) + (field.stored ? 5 : 0);
};

const formatHistoryTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const metricPercent = (value: number) => `${Math.round(value * 100)}%`;

const RankingQuality = ({
  metrics,
  compact = false,
}: {
  metrics: RankingMetrics;
  compact?: boolean;
}) => (
  <div className={compact ? "ranking-quality compact" : "ranking-quality"} aria-label="Ranking quality">
    <Tooltip title={`${metrics.judged} of the top ${metrics.cutoff} results have a relevance judgment.`}>
      <Tag>Coverage {metricPercent(metrics.coverage)}</Tag>
    </Tooltip>
    <Tooltip title="Relevant results divided by judged results; unjudged results are excluded.">
      <Tag color="green">Judged precision {metricPercent(metrics.judged_precision)}</Tag>
    </Tooltip>
    <Tooltip title="Reciprocal rank of the first relevant result. Higher is better.">
      <Tag>MRR {metrics.reciprocal_rank.toFixed(2)}</Tag>
    </Tooltip>
    <Tooltip title="Normalized discounted cumulative gain. Rewards relevant results near the top.">
      <Tag>nDCG {metrics.ndcg.toFixed(2)}</Tag>
    </Tooltip>
  </div>
);

const formatDuration = (milliseconds: number) =>
  milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(2)} s` : `${milliseconds.toFixed(1)} ms`;

const TimingBreakdown = ({ timings }: { timings: SearchTimings }) => {
  const stages: Array<[string, number]> = [
    ["Schema", timings.schema_ms],
    ["Model load", timings.model_load_ms],
    ["Embedding", timings.embedding_ms],
    ["Solr", timings.solr_ms],
    ...(timings.fusion_ms > 0 ? [["Fusion", timings.fusion_ms] as [string, number]] : []),
    ["Overhead", timings.overhead_ms],
  ];
  return (
    <Space size={4} wrap>
      <Tag icon={<TimerReset size={13} />}>{formatDuration(timings.total_ms)} total</Tag>
      {timings.cold_start ? <Tag color="gold">Cold start</Tag> : null}
      {timings.embedding_cache_hit ? <Tag color="green">Embedding cached</Tag> : null}
      <Popover
        trigger="click"
        placement="bottomRight"
        title="Request timing"
        content={
          <dl className="timing-breakdown">
            {stages.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{formatDuration(value)}</dd>
              </div>
            ))}
          </dl>
        }
      >
        <Button size="small" icon={<Gauge size={14} />}>Breakdown</Button>
      </Popover>
    </Space>
  );
};

export const VectorSearchPage = () => {
  const [form] = Form.useForm<SearchFormValues>();
  const requestCoordinator = useRef(new LatestRequestCoordinator()).current;
  const [mode, setMode] = useState<"semantic" | "hybrid">("semantic");
  const [targetMode, setTargetMode] = useState<"single" | "compare" | "fuse">("fuse");
  const [collection, setCollection] = useState(selectedCollection());
  const [compareFields, setCompareFields] = useState<string[]>([]);
  const [fusionWeights, setFusionWeights] = useState<Record<string, number>>({});
  const [vectorMinScores, setVectorMinScores] = useState<Record<string, number | null>>({});
  const [lexicalBoosts, setLexicalBoosts] = useState<Record<string, number>>({});
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [inspectedDocument, setInspectedDocument] = useState<{
    document: Record<string, unknown>;
    rank: number;
    vectorField?: string;
  }>();
  const [judgmentContext, setJudgmentContext] = useState("");
  const [judgments, setJudgments] = useState<RelevanceJudgments>({});
  const [activeSearchPayload, setActiveSearchPayload] = useState<SearchPayload>();
  const [queryInspectorOpen, setQueryInspectorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [scoreAnalysisOpen, setScoreAnalysisOpen] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<SearchHistoryEntry[]>(() => loadSearchHistory());
  const collections = useQuery({ queryKey: ["solr", "collections"], queryFn: api.collections });
  const schema = useQuery({
    queryKey: ["solr", "schema", collection],
    queryFn: () => api.schema(collection),
    enabled: Boolean(collection),
  });
  const searchMutation = useMutation({
    mutationFn: ({ payload, signal }: { payload: SearchPayload; signal: AbortSignal }) =>
      api.search(payload, signal),
    onSuccess: (_, { payload }) => setHistoryEntries(saveSearchHistory(payload)),
    onSettled: (_, __, { signal }) => requestCoordinator.finish(signal),
  });
  const compareMutation = useMutation({
    mutationFn: ({ payload, signal }: { payload: CompareSearchPayload; signal: AbortSignal }) =>
      api.compareSearch(payload, signal),
    onSuccess: (_, { payload }) => {
      const {
        vector_fields: vectorFields,
        vector_min_scores: vectorMinimums,
        ...shared
      } = payload;
      setHistoryEntries(
        saveSearchHistory(
          { ...shared, vector_field: vectorFields[0] },
          vectorFields,
          { targetMode: "compare", vectorMinScores: vectorMinimums },
        ),
      );
    },
    onSettled: (_, __, { signal }) => requestCoordinator.finish(signal),
  });
  const fuseMutation = useMutation({
    mutationFn: ({ payload, signal }: { payload: FuseSearchPayload; signal: AbortSignal }) =>
      api.fuseSearch(payload, signal),
    onSuccess: (_, { payload }) => {
      const {
        vector_fields: vectorFields,
        vector_weights: vectorWeights,
        vector_min_scores: vectorMinimums,
        fusion_candidates: fusionCandidates,
        rrf_k: rrfK,
        ...shared
      } = payload;
      setHistoryEntries(
        saveSearchHistory(
          { ...shared, vector_field: vectorFields[0] },
          vectorFields,
          {
            targetMode: "fuse",
            vectorWeights,
            vectorMinScores: vectorMinimums,
            fusionCandidates,
            rrfK,
          },
        ),
      );
    },
    onSettled: (_, __, { signal }) => requestCoordinator.finish(signal),
  });

  const readyCollections = useMemo(
    () => (collections.data?.collections ?? []).filter((item) => item.ready),
    [collections.data],
  );
  const selectedVectorName = Form.useWatch("vector_field", form);
  const selectedLexicalFields = Form.useWatch("lexical_fields", form) ?? [];
  const hybridStrategy = Form.useWatch("hybrid_strategy", form) ?? "rerank";
  const watchedLexicalWeight = Form.useWatch("lexical_weight", form) ?? 1;
  const watchedVectorWeight = Form.useWatch("vector_weight", form) ?? 1;
  const watchedFusionCandidates = Form.useWatch("fusion_candidates", form) ?? 50;
  const watchedRrfK = Form.useWatch("rrf_k", form) ?? 60;
  const watchedMinScore = Form.useWatch("min_score", form);
  const vectorFields = schema.data?.vector_fields.filter((field) => field.compatible) ?? [];
  const incompatibleVectorFields = schema.data?.vector_fields.filter((field) => !field.compatible) ?? [];
  const selectedVector = vectorFields.find((field) => field.name === selectedVectorName);
  const textFields = useMemo(
    () => [...(schema.data?.text_fields ?? [])].sort((left, right) => textFieldPriority(right) - textFieldPriority(left)),
    [schema.data?.text_fields],
  );
  const allFields = schema.data?.fields ?? [];
  const filterableFields = useMemo(
    () => allFields.filter(
      (field) =>
        field.indexed !== false
        && !field.name.startsWith("_")
        && !field.class?.endsWith("DenseVectorField"),
    ),
    [allFields],
  );
  const structuredFilters = filterRules
    .map((rule) => buildFilterQuery(rule, filterableFields.find((field) => field.name === rule.field)))
    .filter((value): value is string => value !== null);
  const hasIncompleteFilters = filterRules.some((rule) => !filterRuleComplete(rule));

  useEffect(() => {
    if (!collection && readyCollections.length) setCollection(readyCollections[0].name);
  }, [collection, readyCollections]);

  useEffect(() => () => requestCoordinator.cancel(), [requestCoordinator]);

  useEffect(() => {
    if (!schema.data) return;
    const currentVector = form.getFieldValue("vector_field");
    const compatibleVectors = schema.data.vector_fields.filter((field) => field.compatible);
    const firstVector = compatibleVectors.some((field) => field.name === currentVector)
      ? currentVector
      : compatibleVectors[0]?.name;
    setCompareFields((current) => {
      const available = new Set(compatibleVectors.map((field) => field.name));
      const retained = current.filter((field) => available.has(field)).slice(0, MAX_MULTI_VECTOR_FIELDS);
      return retained.length >= 2
        ? retained
        : compatibleVectors.slice(0, MAX_MULTI_VECTOR_FIELDS).map((field) => field.name);
    });
    setFusionWeights((current) => Object.fromEntries(
      compatibleVectors
        .slice(0, MAX_MULTI_VECTOR_FIELDS)
        .map((field) => [field.name, current[field.name] ?? 1]),
    ));
    setVectorMinScores((current) => Object.fromEntries(
      compatibleVectors
        .slice(0, MAX_MULTI_VECTOR_FIELDS)
        .map((field) => [field.name, current[field.name] ?? null]),
    ));
    if (compatibleVectors.length < 2) setTargetMode("single");
    const preferredText = [...schema.data.text_fields]
      .sort((left, right) => textFieldPriority(right) - textFieldPriority(left))
      .filter((field) => !field.name.startsWith("_") && field.class?.includes("TextField"))
      .slice(0, 2)
      .map((field) => field.name);
    setLexicalBoosts((current) => Object.fromEntries(
      preferredText.map((field) => [field, current[field] ?? 1]),
    ));
    form.setFieldsValue({
      collection,
      vector_field: firstVector,
      lexical_fields: preferredText,
      return_fields: schema.data.fields.filter((field) => field.stored).slice(0, 8).map((field) => field.name),
    });
  }, [collection, form, schema.data]);

  const resetResults = () => {
    requestCoordinator.cancel();
    searchMutation.reset();
    compareMutation.reset();
    fuseMutation.reset();
    setInspectedDocument(undefined);
    setActiveSearchPayload(undefined);
    setQueryInspectorOpen(false);
    setScoreAnalysisOpen(false);
  };

  const changeCollection = (value: string) => {
    resetResults();
    setFilterRules([]);
    setTargetMode("fuse");
    setCompareFields([]);
    setVectorMinScores({});
    setCollection(value);
  };

  const changeVectorField = () => resetResults();

  const restoreHistory = (entry: SearchHistoryEntry) => {
    resetResults();
    const restoredComparison = entry.comparison_fields?.slice(0, MAX_MULTI_VECTOR_FIELDS) ?? [];
    setMode(entry.payload.mode);
    setTargetMode(restoredComparison.length >= 2 ? entry.target_mode ?? "compare" : "single");
    setCompareFields(restoredComparison);
    setFusionWeights(entry.vector_weights ?? Object.fromEntries(restoredComparison.map((field) => [field, 1])));
    setVectorMinScores(
      Object.fromEntries(
        restoredComparison.map((field) => [field, entry.vector_min_scores?.[field] ?? null]),
      ),
    );
    setLexicalBoosts(
      entry.payload.lexical_boosts
      ?? Object.fromEntries(entry.payload.lexical_fields.map((field) => [field, 1])),
    );
    setFilterRules([]);
    setCollection(entry.payload.collection);
    form.setFieldsValue({
      ...searchPayloadToFormValues(entry.payload),
      fusion_candidates: entry.fusion_candidates ?? 50,
      rrf_k: entry.rrf_k ?? 60,
    });
    setHistoryOpen(false);
  };

  const runSearch = (
    values: SearchFormValues,
    fieldMinimums: Record<string, number | null>,
  ) => {
    const signal = requestCoordinator.start();
    const payload = buildSearchPayload({
      ...values,
      mode,
      lexical_boosts: lexicalBoosts,
      structured_filters: structuredFilters,
    });
    const context = relevanceContext(payload);
    setJudgmentContext(context);
    setJudgments(loadRelevanceJudgments(context));
    setActiveSearchPayload(payload);
    if (targetMode === "compare") {
      compareMutation.mutate({
        payload: buildCompareSearchPayload(payload, compareFields, fieldMinimums),
        signal,
      });
      return;
    }
    if (targetMode === "fuse") {
      fuseMutation.mutate({
        payload: buildFuseSearchPayload(
          payload,
          compareFields,
          fusionWeights,
          values.fusion_candidates ?? 50,
          values.rrf_k ?? 60,
          fieldMinimums,
        ),
        signal,
      });
      return;
    }
    searchMutation.mutate({ payload, signal });
  };
  const cancelSearch = () => resetResults();
  const submit = (values: SearchFormValues) => runSearch(values, vectorMinScores);
  const applyScoreThreshold = (vectorField: string, threshold: number) => {
    const rounded = Math.round(threshold * 10_000) / 10_000;
    setScoreAnalysisOpen(false);
    if (targetMode === "single") {
      form.setFieldValue("min_score", rounded);
      runSearch(
        { ...form.getFieldsValue(true), min_score: rounded } as SearchFormValues,
        vectorMinScores,
      );
      return;
    }
    const nextMinimums = { ...vectorMinScores, [vectorField]: rounded };
    setVectorMinScores(nextMinimums);
    runSearch(form.getFieldsValue(true) as SearchFormValues, nextMinimums);
  };
  const clearThresholdsAndRetry = () => {
    if (targetMode === "single") {
      form.setFieldValue("min_score", null);
      runSearch(
        { ...form.getFieldsValue(true), min_score: null } as SearchFormValues,
        vectorMinScores,
      );
      return;
    }
    const cleared = clearSelectedThresholds(compareFields, vectorMinScores);
    setVectorMinScores(cleared);
    runSearch(form.getFieldsValue(true) as SearchFormValues, cleared);
  };
  const updateFilterRule = (id: string, changes: Partial<FilterRule>) => {
    resetResults();
    setFilterRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...changes } : rule)));
  };
  const changeFilterField = (rule: FilterRule, fieldName: string) => {
    const field = filterableFields.find((item) => item.name === fieldName);
    const allowed = operatorsForField(field);
    updateFilterRule(rule.id, {
      field: fieldName,
      operator: allowed.some((item) => item.value === rule.operator) ? rule.operator : allowed[0].value,
      value: "",
      secondValue: "",
    });
  };
  const judgeDocument = (document: Record<string, unknown>, judgment?: "relevant" | "irrelevant") => {
    if (!judgmentContext) return;
    setJudgments(updateRelevanceJudgment(judgmentContext, documentJudgmentKey(document), judgment));
  };
  const docs = docsFromResult(searchMutation.data);
  const fusedDocs = fuseMutation.data?.response.response?.docs ?? [];
  const comparedDocumentCount = compareMutation.data?.results.reduce(
    (total, item) => total + (item.response?.response?.docs?.length ?? 0),
    0,
  ) ?? 0;
  const resultVectorMinScores = fuseMutation.data?.vector_min_scores
    ?? compareMutation.data?.vector_min_scores
    ?? {};
  const fusedFieldStatus = fusionFieldDiagnostics(fuseMutation.data);
  const overlap = comparisonOverlap(compareMutation.data);
  const successfulComparisons = compareMutation.data?.results.filter((item) => item.status === "ok") ?? [];
  const scoreProfiles = useMemo(() => {
    if (fuseMutation.data) {
      return buildScoreProfiles(
        fuseMutation.data.field_results
          .filter((item) => item.status === "ok")
          .map((item) => ({
            vector_field: item.vector_field,
            score_samples: item.score_samples,
          })),
      );
    }
    if (compareMutation.data) {
      return buildScoreProfiles(
        compareMutation.data.results
          .filter((item) => item.status === "ok")
          .map((item) => ({
            vector_field: item.vector_field,
            documents: item.response?.response?.docs ?? [],
          })),
      );
    }
    return searchMutation.data
      ? buildScoreProfiles([{
        vector_field: searchMutation.data.vector_field,
        documents: docsFromResult(searchMutation.data),
      }])
      : [];
  }, [compareMutation.data, fuseMutation.data, searchMutation.data]);
  const scoreAnalysisThresholds = Object.keys(resultVectorMinScores).length
    ? resultVectorMinScores
    : activeSearchPayload?.min_score !== null
      && activeSearchPayload?.min_score !== undefined
      && searchMutation.data
      ? { [searchMutation.data.vector_field]: activeSearchPayload.min_score }
      : {};
  const requestPending = searchMutation.isPending || compareMutation.isPending || fuseMutation.isPending;
  const requestError = searchMutation.error ?? compareMutation.error ?? fuseMutation.error;
  const allResultDocuments = fuseMutation.data
    ? fusedDocs
    : compareMutation.data
    ? successfulComparisons.flatMap((item) => item.response?.response?.docs ?? [])
    : docs;
  const overallRelevance = relevanceStats(allResultDocuments, judgments);
  const primaryRanking = rankingMetrics(fuseMutation.data ? fusedDocs : docs, judgments);
  const rankedResultSets: RankedResultSet[] = fuseMutation.data
    ? [{ vector_field: "weighted_rrf", documents: fusedDocs }]
    : compareMutation.data
    ? successfulComparisons.map((item) => ({
      vector_field: item.vector_field,
      documents: item.response?.response?.docs ?? [],
    }))
    : searchMutation.data
      ? [{ vector_field: searchMutation.data.vector_field, documents: docs }]
      : [];
  const currentTimings = fuseMutation.data?.timings
    ?? compareMutation.data?.timings
    ?? searchMutation.data?.timings;
  const executionMetadata: SearchExecutionMetadata | undefined = activeSearchPayload
    ? {
      ...buildQueryRequestPreview(
        activeSearchPayload,
        targetMode === "single" ? [activeSearchPayload.vector_field] : compareFields,
        targetMode,
        {
          vectorWeights: fusionWeights,
          vectorMinScores,
          fusionCandidates: watchedFusionCandidates,
          rrfK: watchedRrfK,
        },
      ),
      target_mode: targetMode,
      timings: currentTimings,
    }
    : undefined;
  const exportResults = (format: "csv" | "json") => {
    if (!activeSearchPayload || !rankedResultSets.length) return;
    const filename = searchExportFilename(activeSearchPayload.collection, format);
    if (format === "csv") {
      const rows = buildSearchExportRows(
        activeSearchPayload,
        rankedResultSets,
        judgments,
        executionMetadata,
      );
      downloadTextFile(filename, `\uFEFF${searchExportRowsToCsv(rows)}`, "text/csv;charset=utf-8");
      return;
    }
    const report = buildSearchEvaluationReport(
      activeSearchPayload,
      rankedResultSets,
      judgments,
      new Date().toISOString(),
      executionMetadata,
    );
    downloadTextFile(filename, JSON.stringify(report, null, 2), "application/json;charset=utf-8");
  };
  const exportButton = activeSearchPayload && rankedResultSets.length ? (
    <Dropdown
      trigger={["click"]}
      menu={{
        items: [
          { key: "csv", label: "Export CSV" },
          { key: "json", label: "Export JSON report" },
        ],
        onClick: ({ key }) => exportResults(key as "csv" | "json"),
      }}
    >
      <Button size="small" icon={<Download size={14} />}>Export</Button>
    </Dropdown>
  ) : null;
  const queryInspectorButton = activeSearchPayload && rankedResultSets.length ? (
    <Button
      size="small"
      icon={<FileSearch size={14} />}
      onClick={() => setQueryInspectorOpen(true)}
    >
      Request
    </Button>
  ) : null;
  const completedSearchMode = fuseMutation.data?.mode
    ?? compareMutation.data?.mode
    ?? searchMutation.data?.mode
    ?? mode;
  const resultScoreSemantics = scoreSemantics(
    targetMode,
    completedSearchMode,
    activeSearchPayload?.hybrid_strategy ?? hybridStrategy,
  );
  const scoreAnalysisButton = scoreProfiles.length
    && supportsSimilarityAnalysis(activeSearchPayload?.mode) ? (
    <Button
      size="small"
      icon={<BarChart3 size={14} />}
      onClick={() => setScoreAnalysisOpen(true)}
    >
      Scores
    </Button>
  ) : null;
  const thresholdCount = Object.keys(resultVectorMinScores).length;
  const thresholdTag = thresholdCount
    ? <Tag color="cyan">{thresholdCount} field threshold{thresholdCount === 1 ? "" : "s"}</Tag>
    : activeSearchPayload?.min_score !== null && activeSearchPayload?.min_score !== undefined
      ? <Tag color="cyan">Score ≥ {activeSearchPayload.min_score}</Tag>
      : null;
  const completedResultCount = fuseMutation.data
    ? fusedDocs.length
    : compareMutation.data
      ? comparedDocumentCount
      : searchMutation.data
        ? docs.length
        : null;
  const completedSearchHasThreshold = targetMode === "single"
    ? activeSearchPayload?.min_score !== null && activeSearchPayload?.min_score !== undefined
    : hasSelectedThreshold(compareFields, resultVectorMinScores);
  const showThresholdRecovery = completedResultCount === 0 && completedSearchHasThreshold;
  const resultColumns: ColumnsType<Record<string, unknown>> = [
    {
      title: "",
      key: "inspect",
      width: 118,
      render: (_, document, index) => (
        <div className="result-row-actions">
          <RelevanceButtons
            label={documentDisplayTitle(document)}
            value={judgments[documentJudgmentKey(document)]}
            onChange={(value) => judgeDocument(document, value)}
          />
          <Tooltip title="Inspect document">
            <Button
              type="text"
              size="small"
              icon={<Eye size={15} />}
              aria-label={`Inspect ${documentDisplayTitle(document)}`}
              onClick={() =>
                setInspectedDocument({
                  document,
                  rank: index + 1,
                  vectorField: fuseMutation.data ? "weighted_rrf" : searchMutation.data?.vector_field,
                })}
            />
          </Tooltip>
        </div>
      ),
    },
    { title: "Rank", key: "rank", width: 72, render: (_, __, index) => index + 1 },
    {
      title: (
        <Space size={4}>
          <span>{resultScoreSemantics.label}</span>
          <Tooltip title={resultScoreSemantics.help}>
            <span
              className="score-heading-help"
              aria-label={`${resultScoreSemantics.label} explanation`}
            >
              <CircleHelp size={13} />
            </span>
          </Tooltip>
        </Space>
      ),
      dataIndex: "score",
      key: "score",
      width: 150,
      render: (score: unknown) => (typeof score === "number" ? score.toFixed(5) : "—"),
    },
    {
      title: "Document",
      key: "document",
      render: (_, document) => {
        const entries = Object.entries(document)
          .filter(([key]) => key !== "score" && key !== "_fusion")
          .slice(0, 4);
        const fusion = document._fusion as {
          ranks?: Record<string, number>;
          source_scores?: Record<string, number>;
        } | undefined;
        return (
          <Space direction="vertical" size={2} className="result-document">
            {fusion?.ranks ? (
              <Space size={[4, 4]} wrap className="fusion-source-ranks">
                {Object.entries(fusion.ranks).map(([field, rank]) => (
                  <Tag key={field}>
                    {field} #{rank}
                    {fusion.source_scores?.[field] !== undefined
                      ? ` · ${fusion.source_scores[field].toFixed(4)}`
                      : ""}
                  </Tag>
                ))}
              </Space>
            ) : null}
            {entries.map(([key, value]) => {
              const summary = summarizeSolrValue(value);
              return (
                <Typography.Text key={key} ellipsis={{ tooltip: summary.tooltip }}>
                  <span className="field-key">{key}</span> {summary.text}
                </Typography.Text>
              );
            })}
          </Space>
        );
      },
    },
  ];

  return (
    <section>
      <PageHeader
        title="Vector Search"
        description="Write a query in plain English. The backend embeds it locally and sends a controlled KNN request to Solr."
        actions={
          <Button icon={<HistoryIcon size={16} />} onClick={() => setHistoryOpen(true)}>
            Recent searches
            {historyEntries.length ? <Badge count={historyEntries.length} size="small" /> : null}
          </Button>
        }
      />
      <div className="search-workbench">
        <div className="surface search-controls">
          <Form<SearchFormValues>
            form={form}
            layout="vertical"
            initialValues={{
              mode: "semantic",
              hybrid_strategy: "rerank",
              limit: 10,
              vector_candidates: 100,
              lexical_candidates: 100,
              rerank_docs: 100,
              rerank_weight: 2,
              lexical_weight: 1,
              vector_weight: 1,
              hybrid_rrf_k: 60,
              timeout_ms: 15_000,
              fusion_candidates: 50,
              rrf_k: 60,
            }}
            onFinish={submit}
            onValuesChange={resetResults}
          >
            <div className="search-mode-row">
              <Segmented
                value={mode}
                options={[{ label: "Semantic", value: "semantic" }, { label: "Hybrid", value: "hybrid" }]}
                onChange={(value) => {
                  resetResults();
                  setMode(value as "semantic" | "hybrid");
                }}
              />
              <Tag color="blue">384d · normalized</Tag>
            </div>
            {mode === "hybrid" ? (
              <Form.Item name="hybrid_strategy" label="Hybrid retrieval">
                <Segmented
                  block
                  options={[
                    { label: "Rerank", value: "rerank" },
                    { label: "RRF fusion", value: "rrf" },
                  ]}
                  onChange={resetResults}
                />
              </Form.Item>
            ) : null}
            <Form.Item
              name="text"
              label="Query"
              rules={[{ required: true, whitespace: true, message: "Enter a query in English." }]}
            >
              <Input.TextArea
                autoSize={{ minRows: 3, maxRows: 7 }}
                placeholder="Find documents about zero-downtime schema migrations"
                maxLength={5000}
                showCount
              />
            </Form.Item>
            {vectorFields.length > 1 ? (
              <div className="search-target-mode">
                <Segmented
                  block
                  value={targetMode}
                  options={[
                    { label: "One field", value: "single", icon: <Search size={14} /> },
                    { label: "Blend all", value: "fuse", icon: <Combine size={14} /> },
                    { label: "Compare", value: "compare", icon: <GitCompareArrows size={14} /> },
                  ]}
                  onChange={(value) => {
                    resetResults();
                    setTargetMode(value as "single" | "compare" | "fuse");
                  }}
                />
              </div>
            ) : null}
            <div className="search-target-grid">
              <Form.Item className="search-target-collection" name="collection" label="Collection" rules={[{ required: true }]}>
                <AdaptiveSelect
                  loading={collections.isLoading}
                  options={readyCollections.map((item) => ({ label: item.name, value: item.name }))}
                  onChange={changeCollection}
                  placeholder="Select collection"
                />
              </Form.Item>
              {targetMode === "single" ? (
                <Form.Item name="vector_field" label="Vector field" rules={[{ required: true }]}>
                  <AdaptiveSelect
                    loading={schema.isLoading}
                    options={vectorFields.map((field) => ({
                      label: field.name,
                      value: field.name,
                      description: `${field.dimension}d · ${field.similarity_function} · ${field.vector_encoding}`,
                    }))}
                    onChange={changeVectorField}
                    placeholder="Select vector field"
                  />
                </Form.Item>
              ) : (
                <Form.Item
                  label="Vector fields"
                  validateStatus={compareFields.length < 2 ? "error" : undefined}
                  help={compareFields.length < 2 ? "Select at least two fields." : undefined}
                >
                  <Select
                    mode="multiple"
                    value={compareFields}
                    maxCount={MAX_MULTI_VECTOR_FIELDS}
                    maxTagCount="responsive"
                    maxTagTextLength={24}
                    options={vectorFields.map((field) => ({ label: field.name, value: field.name }))}
                    onChange={(value) => {
                      resetResults();
                      setCompareFields(value);
                    }}
                    placeholder={`Select 2-${MAX_MULTI_VECTOR_FIELDS} vector fields`}
                  />
                </Form.Item>
              )}
              <Form.Item name="limit" label={mode === "semantic" ? "Results (topK)" : "Results"}>
                <InputNumber min={1} max={100} className="full-width" />
              </Form.Item>
            </div>
            {targetMode !== "single" && compareFields.length ? (
              <div className="fusion-weights">
                <div className="fusion-weights-heading">
                  <Typography.Text strong>Vector field controls</Typography.Text>
                  <Typography.Text type="secondary">
                    Thresholds apply before {targetMode === "fuse" ? "ranking fusion" : "comparison"}
                  </Typography.Text>
                </div>
                <div className={`fusion-control-legend ${targetMode === "fuse" ? "with-weight" : ""}`}>
                  <span />
                  <Typography.Text type="secondary">Min score</Typography.Text>
                  {targetMode === "fuse" ? <Typography.Text type="secondary">Weight</Typography.Text> : null}
                </div>
                <div className="fusion-weight-grid">
                  {compareFields.map((field) => (
                    <div
                      key={field}
                      className={`fusion-weight-row ${targetMode === "fuse" ? "with-weight" : ""}`}
                    >
                      <Typography.Text ellipsis={{ tooltip: field }}>{field}</Typography.Text>
                      <InputNumber
                        min={-1}
                        max={1}
                        step={0.01}
                        precision={4}
                        value={vectorMinScores[field]}
                        placeholder="Any"
                        aria-label={`${field} minimum similarity`}
                        onChange={(value) => {
                          resetResults();
                          setVectorMinScores((current) => ({ ...current, [field]: value }));
                        }}
                      />
                      {targetMode === "fuse" ? (
                        <InputNumber
                          min={0}
                          max={10}
                          step={0.1}
                          value={fusionWeights[field] ?? 1}
                          addonAfter="x"
                          aria-label={`${field} fusion weight`}
                          onChange={(value) => {
                            resetResults();
                            setFusionWeights((current) => ({ ...current, [field]: value ?? 1 }));
                          }}
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {targetMode === "single" && selectedVector ? (
              <div className="vector-field-meta" aria-label="Selected vector field details">
                <Typography.Text type="secondary">Vector configuration</Typography.Text>
                <Space size={[4, 4]} wrap>
                  <Tag>{selectedVector.dimension} dimensions</Tag>
                  <Tag>{selectedVector.similarity_function}</Tag>
                  <Tag>{selectedVector.vector_encoding}</Tag>
                  {vectorFields.length > 1 ? <Tag color="blue">{vectorFields.length} compatible fields</Tag> : null}
                </Space>
              </div>
            ) : null}
            {incompatibleVectorFields.length ? (
              <Alert
                className="vector-field-warning"
                type="warning"
                showIcon
                message={`${incompatibleVectorFields.length} vector field${incompatibleVectorFields.length > 1 ? "s are" : " is"} unavailable for this model`}
                description={incompatibleVectorFields.map((field) => `${field.name}: ${field.reason}`).join(" · ")}
              />
            ) : null}
            {mode === "hybrid" ? (
              <Form.Item name="lexical_fields" label="BM25 fields" rules={[{ required: true }]}>
                <Select
                  mode="multiple"
                  options={textFields.map((field) => ({ label: field.name, value: field.name }))}
                  placeholder="Select one or more text fields"
                  onChange={(fields: string[]) => {
                    resetResults();
                    setLexicalBoosts((current) => Object.fromEntries(
                      fields.map((field) => [field, current[field] ?? 1]),
                    ));
                  }}
                />
              </Form.Item>
            ) : null}
            {mode === "hybrid" && selectedLexicalFields.length ? (
              <div className="lexical-boosts">
                <div className="lexical-boosts-heading">
                  <Typography.Text strong>BM25 field boosts</Typography.Text>
                  <Typography.Text type="secondary">Increase influence for more important text fields</Typography.Text>
                </div>
                <div className="lexical-boost-grid">
                  {selectedLexicalFields.map((field: string) => (
                    <label key={field} className="lexical-boost-row">
                      <Typography.Text ellipsis={{ tooltip: field }}>{field}</Typography.Text>
                      <InputNumber
                        min={0}
                        max={20}
                        step={0.1}
                        value={lexicalBoosts[field] ?? 1}
                        addonAfter="x"
                        aria-label={`${field} BM25 boost`}
                        onChange={(value) => {
                          resetResults();
                          setLexicalBoosts((current) => ({ ...current, [field]: value ?? 1 }));
                        }}
                      />
                    </label>
                  ))}
                </div>
                {hybridStrategy === "rrf" ? (
                  <Form.Item
                    name="lexical_weight"
                    label="BM25 fusion weight"
                    className="lexical-source-weight"
                  >
                    <InputNumber min={0} max={10} step={0.1} addonAfter="x" className="full-width" />
                  </Form.Item>
                ) : null}
              </div>
            ) : null}
            <Collapse
              ghost
              className="advanced-collapse"
              items={[
                {
                  key: "advanced",
                  label: "Advanced controls",
                  children: (
                    <>
                      {targetMode === "single" ? <div className="form-grid two">
                        <Form.Item
                          name="min_score"
                          label="Minimum similarity"
                          tooltip="Only return per-field vector matches at or above this Solr similarity score."
                        >
                          <InputNumber
                            min={-1}
                            max={1}
                            step={0.01}
                            precision={4}
                            placeholder="No threshold"
                            className="full-width"
                          />
                        </Form.Item>
                      </div> : null}
                      {mode === "hybrid" && hybridStrategy === "rerank" ? (
                        <div className="form-grid three">
                          <Form.Item
                            name="vector_candidates"
                            label="Vector candidates"
                            tooltip={watchedMinScore !== null && watchedMinScore !== undefined
                              ? "Not used when a minimum similarity is set."
                              : undefined}
                          >
                            <InputNumber
                              min={1}
                              max={10_000}
                              disabled={watchedMinScore !== null && watchedMinScore !== undefined}
                              className="full-width"
                            />
                          </Form.Item>
                          <Form.Item name="rerank_docs" label="Rerank documents">
                            <InputNumber min={1} max={10_000} className="full-width" />
                          </Form.Item>
                          <Form.Item name="rerank_weight" label="Vector weight">
                            <InputNumber min={0} max={10} step={0.1} className="full-width" />
                          </Form.Item>
                        </div>
                      ) : null}
                      {mode === "hybrid" && hybridStrategy === "rrf" ? (
                        <div className={targetMode === "fuse" ? "form-grid one" : "form-grid four"}>
                          <Form.Item name="lexical_candidates" label="BM25 candidates">
                            <InputNumber min={1} max={10_000} className="full-width" />
                          </Form.Item>
                          {targetMode !== "fuse" ? (
                            <>
                              <Form.Item
                                name="vector_candidates"
                                label={watchedMinScore !== null && watchedMinScore !== undefined
                                  ? "Max vector results"
                                  : "Vector candidates"}
                              >
                                <InputNumber min={1} max={10_000} className="full-width" />
                              </Form.Item>
                              <Form.Item name="vector_weight" label="Vector fusion weight">
                                <InputNumber min={0} max={10} step={0.1} addonAfter="x" className="full-width" />
                              </Form.Item>
                              <Form.Item name="hybrid_rrf_k" label="RRF constant">
                                <InputNumber min={1} max={1000} className="full-width" />
                              </Form.Item>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                      {targetMode === "fuse" ? (
                        <div className="form-grid two">
                          <Form.Item
                            name="fusion_candidates"
                            label={watchedMinScore !== null && watchedMinScore !== undefined
                              ? "Max results per field"
                              : "Candidates per field"}
                            tooltip="Each vector field contributes this many candidates before fusion."
                          >
                            <InputNumber min={2} max={500} className="full-width" />
                          </Form.Item>
                          <Form.Item
                            name="rrf_k"
                            label="RRF constant"
                            tooltip="Higher values make rank differences less aggressive."
                          >
                            <InputNumber min={1} max={1000} className="full-width" />
                          </Form.Item>
                        </div>
                      ) : null}
                      <div className="form-grid two">
                        <Form.Item
                          name="timeout_ms"
                          label="Query timeout"
                          tooltip="Stops Solr work and the HTTP request when this limit is reached."
                        >
                          <InputNumber
                            min={1_000}
                            max={120_000}
                            step={1_000}
                            addonAfter="ms"
                            className="full-width"
                          />
                        </Form.Item>
                      </div>
                      <div className="filter-builder">
                        <div className="filter-builder-heading">
                          <Typography.Text strong>Filter builder</Typography.Text>
                          <Button
                            type="text"
                            size="small"
                            icon={<Plus size={15} />}
                            disabled={!filterableFields.length}
                            onClick={() => {
                              resetResults();
                              setFilterRules((current) => [
                                ...current,
                                createFilterRule(filterableFields[0]?.name ?? ""),
                              ]);
                            }}
                          >
                            Add filter
                          </Button>
                        </div>
                        {filterRules.map((rule) => {
                          const field = filterableFields.find((item) => item.name === rule.field);
                          const operatorOptions = operatorsForField(field);
                          return (
                            <div className="filter-rule-row" key={rule.id}>
                              <Select
                                className="filter-rule-field"
                                value={rule.field}
                                options={filterableFields.map((item) => ({ label: item.name, value: item.name }))}
                                onChange={(value) => changeFilterField(rule, value)}
                                showSearch
                                optionFilterProp="label"
                                aria-label="Filter field"
                              />
                              <Select
                                className="filter-rule-operator"
                                value={rule.operator}
                                options={operatorOptions}
                                onChange={(operator) =>
                                  updateFilterRule(rule.id, { operator, value: "", secondValue: "" })}
                                aria-label={`${rule.field} filter operator`}
                              />
                              <div className="filter-rule-value">
                                <FilterValueInput
                                  rule={rule}
                                  field={field}
                                  onChange={(changes) => updateFilterRule(rule.id, changes)}
                                />
                              </div>
                              <Tooltip title="Remove filter">
                                <Button
                                  type="text"
                                  danger
                                  className="filter-rule-remove"
                                  icon={<Trash2 size={15} />}
                                  aria-label={`Remove ${rule.field} filter`}
                                  onClick={() => {
                                    resetResults();
                                    setFilterRules((current) => current.filter((item) => item.id !== rule.id));
                                  }}
                                />
                              </Tooltip>
                              {!filterRuleComplete(rule) ? (
                                <Typography.Text type="danger" className="filter-rule-error">
                                  Complete this filter
                                </Typography.Text>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                      <Form.Item name="filters" label="Raw filter queries">
                        <Input.TextArea rows={3} placeholder={"category:engineering\nin_stock:true"} />
                      </Form.Item>
                      <Form.Item name="return_fields" label="Return fields">
                        <Select
                          mode="multiple"
                          options={allFields.map((field) => ({ label: field.name, value: field.name }))}
                          placeholder="Default stored fields"
                        />
                      </Form.Item>
                    </>
                  ),
                },
              ]}
            />
            {requestError ? (
              <Alert type="error" showIcon message="Search failed" description={errorMessage(requestError)} />
            ) : null}
            <div className="search-submit-row">
              <Button
                type="primary"
                htmlType="submit"
                icon={
                  targetMode === "compare"
                    ? <GitCompareArrows size={17} />
                    : targetMode === "fuse" ? <Combine size={17} /> : <Search size={17} />
                }
                loading={requestPending}
                disabled={
                  !vectorFields.length
                  || hasIncompleteFilters
                  || (targetMode !== "single" && compareFields.length < 2)
                  || (
                    targetMode === "fuse"
                    && !compareFields.some((field) => (fusionWeights[field] ?? 1) > 0)
                    && !(
                      mode === "hybrid"
                      && hybridStrategy === "rrf"
                      && watchedLexicalWeight > 0
                    )
                  )
                  || (
                    mode === "hybrid"
                    && !selectedLexicalFields.some((field: string) => (lexicalBoosts[field] ?? 1) > 0)
                  )
                  || (
                    mode === "hybrid"
                    && hybridStrategy === "rrf"
                    && targetMode !== "fuse"
                    && watchedLexicalWeight <= 0
                    && watchedVectorWeight <= 0
                  )
                }
                size="large"
              >
                {targetMode === "compare"
                  ? "Compare fields"
                  : targetMode === "fuse" ? "Search all fields" : "Search Solr"}
              </Button>
              {requestPending ? (
                <Button
                  size="large"
                  icon={<CircleStop size={17} />}
                  onClick={cancelSearch}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </Form>
        </div>
        <div className="surface results-panel">
          <div className="panel-heading">
            <div>
              <Typography.Title level={3}>
                {fuseMutation.data ? "Fused ranking" : compareMutation.data ? "Field comparison" : "Results"}
              </Typography.Title>
              <Typography.Text type="secondary">
                {fuseMutation.data
                  ? `${fusedDocs.length} results merged from ${fusedFieldStatus.active.length} active ${
                    fuseMutation.data.mode === "hybrid" && fuseMutation.data.hybrid_strategy === "rrf"
                      ? "source"
                      : "field"
                  }${fusedFieldStatus.active.length === 1 ? "" : "s"}`
                  : compareMutation.data
                  ? `${successfulComparisons.length} fields compared`
                  : `${searchMutation.data?.response.response?.numFound ?? 0} matches returned`}
              </Typography.Text>
            </div>
            {fuseMutation.data ? (
              <Space size="small" wrap>
                <TimingBreakdown timings={fuseMutation.data.timings} />
                {thresholdTag}
                <Tag color="blue">Weighted RRF</Tag>
                {scoreAnalysisButton}
                {queryInspectorButton}
                {exportButton}
              </Space>
            ) : compareMutation.data ? (
              <Space size="small" wrap>
                <TimingBreakdown timings={compareMutation.data.timings} />
                {thresholdTag}
                {scoreAnalysisButton}
                {queryInspectorButton}
                {exportButton}
              </Space>
            ) : searchMutation.data ? (
              <Space size="small" wrap>
                <TimingBreakdown timings={searchMutation.data.timings} />
                {thresholdTag}
                {scoreAnalysisButton}
                {queryInspectorButton}
                {exportButton}
              </Space>
            ) : null}
          </div>
          {overallRelevance.judged ? (
            <div className="relevance-summary">
              <Space size={[6, 6]} wrap>
                <Tag color="green">{overallRelevance.relevant} relevant</Tag>
                <Tag color="red">{overallRelevance.irrelevant} not relevant</Tag>
                <Typography.Text type="secondary">
                  {overallRelevance.judged}/{overallRelevance.total} unique documents judged
                </Typography.Text>
              </Space>
              <Popconfirm
                title="Clear relevance judgments for this query?"
                onConfirm={() => setJudgments(clearRelevanceJudgments(judgmentContext))}
              >
                <Button type="text" size="small">Clear judgments</Button>
              </Popconfirm>
            </div>
          ) : null}
          {!compareMutation.data && primaryRanking.judged ? (
            <RankingQuality metrics={primaryRanking} />
          ) : null}
          {showThresholdRecovery ? (
            <Alert
              className="threshold-recovery"
              type="info"
              showIcon
              message="No results passed the similarity threshold"
              description="Clear the active thresholds and run the same query again."
              action={(
                <Button
                  icon={<RotateCcw size={15} />}
                  onClick={clearThresholdsAndRetry}
                  loading={requestPending}
                >
                  Clear and retry
                </Button>
              )}
            />
          ) : null}
          {fuseMutation.data ? (
            <>
              {fusedFieldStatus.failed.length ? (
                <Alert
                  className="fusion-field-alert"
                  type="warning"
                  showIcon
                  message={`Fused ranking excludes ${fusedFieldStatus.failed.length} failed vector field${fusedFieldStatus.failed.length > 1 ? "s" : ""}`}
                  description={fuseMutation.data.field_results
                    .filter((item) => item.status === "error")
                    .map((item) => `${item.vector_field}: ${errorMessage({ detail: item.error })}`)
                    .join(" · ")}
                />
              ) : null}
              <div className="fusion-summary">
                <Space size={[5, 5]} wrap>
                {fuseMutation.data.field_results.map((item) => (
                    <Tag
                      key={item.vector_field}
                      color={item.status === "error" ? "red" : item.status === "ok" ? "blue" : undefined}
                    >
                      {item.vector_field} · {
                        item.status === "error"
                          ? "failed"
                          : item.status === "skipped"
                            ? "off"
                            : [
                              `${
                                item.vector_field === "BM25"
                                  ? fuseMutation.data.lexical_weight ?? 1
                                  : fuseMutation.data.vector_weights[item.vector_field]
                              }x`,
                              `${sourceReturnedCount(item)} returned`,
                              fuseMutation.data.vector_min_scores[item.vector_field] !== undefined
                                ? `≥${fuseMutation.data.vector_min_scores[item.vector_field]}`
                                : null,
                            ].filter(Boolean).join(" · ")
                      }
                    </Tag>
                  ))}
                </Space>
                <Typography.Text type="secondary">
                  {fusedFieldStatus.active.length} active sources · {fuseMutation.data.fusion_candidates} vector candidates / field · RRF k={fuseMutation.data.rrf_k}
                </Typography.Text>
              </div>
              <Table
                className="search-results-table"
                rowKey={(record) => String(record.id ?? record._version_ ?? JSON.stringify(record))}
                columns={resultColumns}
                dataSource={fusedDocs}
                pagination={false}
                size="middle"
                tableLayout="fixed"
                locale={{
                  emptyText: (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="No documents matched this query"
                    />
                  ),
                }}
              />
              <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} className="result-metadata">
                <Descriptions.Item label="Mode">{fuseMutation.data.mode}</Descriptions.Item>
                <Descriptions.Item label="Collection">{fuseMutation.data.collection}</Descriptions.Item>
                <Descriptions.Item label="Fusion">Weighted RRF</Descriptions.Item>
                {fuseMutation.data.mode === "hybrid" ? (
                  <Descriptions.Item label="Hybrid strategy">
                    {fuseMutation.data.hybrid_strategy === "rrf" ? "Parallel RRF" : "Vector rerank"}
                  </Descriptions.Item>
                ) : null}
                <Descriptions.Item label="Model">{fuseMutation.data.model}</Descriptions.Item>
                <Descriptions.Item label="Dimension">{fuseMutation.data.dimension}</Descriptions.Item>
              </Descriptions>
            </>
          ) : compareMutation.data ? (
            <>
              <div className="comparison-summary">
                {overlap ? (
                  <Tag color={overlap.percentage >= 50 ? "green" : "gold"}>
                    {overlap.shared}/{overlap.comparable} shared · {overlap.percentage}% overlap
                  </Tag>
                ) : null}
                <Typography.Text type="secondary">
                  {compareMutation.data.vector_fields.join(" · ")}
                </Typography.Text>
              </div>
              <div className="comparison-grid">
                {compareMutation.data.results.map((item) => {
                  const comparisonDocs = item.response?.response?.docs ?? [];
                  const failedSources = item.source_results?.filter(
                    (source) => source.status === "error",
                  ) ?? [];
                  const fieldRelevance = relevanceStats(comparisonDocs, judgments);
                  const fieldRanking = rankingMetrics(comparisonDocs, judgments);
                  return (
                    <section className="comparison-column" key={item.vector_field}>
                      <div className="comparison-column-header">
                        <Typography.Title level={4}>{item.vector_field}</Typography.Title>
                        <Space size={4} wrap>
                          <Tag>{resultScoreSemantics.label}</Tag>
                          {fieldRelevance.judged ? (
                            <Tag color="green">{fieldRelevance.relevant}/{fieldRelevance.judged} relevant</Tag>
                          ) : null}
                          {item.solr_ms !== undefined ? <Tag>{item.solr_ms.toFixed(1)} ms</Tag> : null}
                          {compareMutation.data.vector_min_scores[item.vector_field] !== undefined ? (
                            <Tag color="cyan">
                              ≥ {compareMutation.data.vector_min_scores[item.vector_field]}
                            </Tag>
                          ) : null}
                        </Space>
                      </div>
                      {item.source_results?.length ? (
                        <Space size={[4, 4]} wrap>
                          {item.source_results.map((source) => (
                            <Tag
                              key={source.vector_field}
                              color={source.status === "error" ? "red" : source.status === "ok" ? "blue" : undefined}
                            >
                              {source.vector_field} · {
                                source.status === "ok"
                                  ? `${sourceReturnedCount(source)} returned`
                                  : source.status === "skipped" ? "off" : "failed"
                              }
                            </Tag>
                          ))}
                        </Space>
                      ) : null}
                      {failedSources.length ? (
                        <Alert
                          type="warning"
                          showIcon
                          message="Partial hybrid result"
                          description={failedSources
                            .map((source) => `${source.vector_field}: ${errorMessage({ detail: source.error })}`)
                            .join(" · ")}
                        />
                      ) : null}
                      {fieldRanking.judged ? <RankingQuality metrics={fieldRanking} compact /> : null}
                      {item.status === "error" ? (
                        <Alert
                          type="error"
                          showIcon
                          message="Field search failed"
                          description={errorMessage({ detail: item.error })}
                        />
                      ) : (
                        comparisonDocs.length ? (
                          <ol className="comparison-ranking">
                            {comparisonDocs.map((document, index) => (
                              <li key={String(document.id ?? document._version_ ?? index)}>
                                <span className="comparison-rank">{index + 1}</span>
                                <div className="comparison-document">
                                  <Typography.Text strong ellipsis={{ tooltip: documentDisplayTitle(document) }}>
                                    {documentDisplayTitle(document)}
                                  </Typography.Text>
                                  <Typography.Text type="secondary" ellipsis={{ tooltip: documentSubtitle(document) }}>
                                    {documentSubtitle(document) || "No document identifier"}
                                  </Typography.Text>
                                </div>
                                <Typography.Text code>
                                  {typeof document.score === "number" ? document.score.toFixed(4) : "—"}
                                </Typography.Text>
                                <div className="result-row-actions">
                                  <RelevanceButtons
                                    label={`${documentDisplayTitle(document)} from ${item.vector_field}`}
                                    value={judgments[documentJudgmentKey(document)]}
                                    onChange={(value) => judgeDocument(document, value)}
                                  />
                                  <Tooltip title="Inspect document">
                                    <Button
                                      type="text"
                                      size="small"
                                      icon={<Eye size={14} />}
                                      aria-label={`Inspect ${documentDisplayTitle(document)} from ${item.vector_field}`}
                                      onClick={() =>
                                        setInspectedDocument({
                                          document,
                                          rank: index + 1,
                                          vectorField: item.vector_field,
                                        })}
                                    />
                                  </Tooltip>
                                </div>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="No documents matched this field"
                          />
                        )
                      )}
                    </section>
                  );
                })}
              </div>
              <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} className="result-metadata">
                <Descriptions.Item label="Mode">{compareMutation.data.mode}</Descriptions.Item>
                <Descriptions.Item label="Collection">{compareMutation.data.collection}</Descriptions.Item>
                <Descriptions.Item label="Model">{compareMutation.data.model}</Descriptions.Item>
                <Descriptions.Item label="Dimension">{compareMutation.data.dimension}</Descriptions.Item>
              </Descriptions>
            </>
          ) : searchMutation.data ? (
            <>
              {searchMutation.data.mode === "hybrid"
                && searchMutation.data.hybrid_strategy === "rrf"
                && searchMutation.data.field_results ? (
                  <>
                    {searchMutation.data.field_results.some((item) => item.status === "error") ? (
                      <Alert
                        type="warning"
                        showIcon
                        message="Partial hybrid result"
                        description={searchMutation.data.field_results
                          .filter((item) => item.status === "error")
                          .map((item) => `${item.vector_field}: ${errorMessage({ detail: item.error })}`)
                          .join(" · ")}
                      />
                    ) : null}
                    <div className="fusion-summary">
                      <Space size={[5, 5]} wrap>
                        {searchMutation.data.field_results.map((item) => (
                          <Tag
                            key={item.vector_field}
                            color={item.status === "error" ? "red" : item.status === "ok" ? "blue" : undefined}
                          >
                            {item.vector_field} · {
                              item.status === "ok"
                                ? [
                                  `${searchMutation.data?.source_weights?.[item.vector_field] ?? 1}x`,
                                  `${sourceReturnedCount(item)} returned`,
                                ].join(" · ")
                                : item.status === "skipped" ? "off" : "failed"
                            }
                          </Tag>
                        ))}
                      </Space>
                      <Typography.Text type="secondary">
                        Parallel retrieval · RRF k={searchMutation.data.rrf_k ?? activeSearchPayload?.hybrid_rrf_k}
                      </Typography.Text>
                    </div>
                  </>
                ) : null}
              <Table
                className="search-results-table"
                rowKey={(record) => String(record.id ?? record._version_ ?? JSON.stringify(record))}
                columns={resultColumns}
                dataSource={docs}
                pagination={false}
                size="middle"
                tableLayout="fixed"
                locale={{
                  emptyText: (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="No documents matched this query"
                    />
                  ),
                }}
              />
              <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} className="result-metadata">
                <Descriptions.Item label="Mode">{searchMutation.data.mode}</Descriptions.Item>
                <Descriptions.Item label="Collection">{searchMutation.data.collection}</Descriptions.Item>
                <Descriptions.Item label="Vector field">{searchMutation.data.vector_field}</Descriptions.Item>
                {searchMutation.data.mode === "hybrid" ? (
                  <Descriptions.Item label="Hybrid strategy">
                    {searchMutation.data.hybrid_strategy === "rrf" ? "Parallel RRF" : "Vector rerank"}
                  </Descriptions.Item>
                ) : null}
                <Descriptions.Item label="Model">all-MiniLM-L6-v2</Descriptions.Item>
                <Descriptions.Item label="Dimension">{searchMutation.data.dimension}</Descriptions.Item>
              </Descriptions>
            </>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Run a search to inspect ranked Solr documents" />
          )}
        </div>
      </div>
      <DocumentInspector
        document={inspectedDocument?.document}
        judgment={
          inspectedDocument
            ? judgments[documentJudgmentKey(inspectedDocument.document)]
            : undefined
        }
        rank={inspectedDocument?.rank}
        scoreLabel={resultScoreSemantics.label}
        vectorField={inspectedDocument?.vectorField}
        open={Boolean(inspectedDocument)}
        onJudgmentChange={
          inspectedDocument
            ? (value) => judgeDocument(inspectedDocument.document, value)
            : undefined
        }
        onClose={() => setInspectedDocument(undefined)}
      />
      <QueryInspector
        open={queryInspectorOpen}
        payload={activeSearchPayload}
        vectorFields={targetMode === "single" ? [activeSearchPayload?.vector_field ?? ""] : compareFields}
        targetMode={targetMode}
        fusion={{
          vectorWeights: fusionWeights,
          vectorMinScores,
          fusionCandidates: watchedFusionCandidates,
          rrfK: watchedRrfK,
        }}
        onClose={() => setQueryInspectorOpen(false)}
      />
      <ScoreAnalysisDrawer
        open={scoreAnalysisOpen}
        profiles={scoreProfiles}
        thresholds={scoreAnalysisThresholds}
        onApplyThreshold={applyScoreThreshold}
        onClose={() => setScoreAnalysisOpen(false)}
      />
      <Drawer
        title="Recent searches"
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        width="min(440px, 100vw)"
        className="search-history-drawer"
        extra={
          <Popconfirm
            title="Clear all recent searches?"
            onConfirm={() => setHistoryEntries(clearSearchHistory())}
          >
            <Button type="text" danger disabled={!historyEntries.length} icon={<Trash2 size={15} />}>
              Clear
            </Button>
          </Popconfirm>
        }
      >
        <List
          dataSource={historyEntries}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No successful searches yet" /> }}
          renderItem={(entry) => (
            <List.Item
              key={entry.id}
              actions={[
                <Tooltip key="restore" title="Restore search controls">
                  <Button
                    type="text"
                    icon={<RotateCcw size={15} />}
                    aria-label={`Restore ${entry.payload.text}`}
                    onClick={() => restoreHistory(entry)}
                  />
                </Tooltip>,
                <Tooltip key="remove" title="Remove from history">
                  <Button
                    type="text"
                    danger
                    icon={<Trash2 size={15} />}
                    aria-label={`Remove ${entry.payload.text}`}
                    onClick={() => setHistoryEntries(removeSearchHistory(entry.id))}
                  />
                </Tooltip>,
              ]}
            >
              <List.Item.Meta
                title={
                  <div className="history-query-row">
                    <Typography.Text ellipsis={{ tooltip: entry.payload.text }}>{entry.payload.text}</Typography.Text>
                    <Tag color={entry.payload.mode === "hybrid" ? "geekblue" : "blue"}>{entry.payload.mode}</Tag>
                    {entry.comparison_fields?.length ? (
                      <Tag color={entry.target_mode === "fuse" ? "blue" : "cyan"}>
                        {entry.target_mode === "fuse" ? "fuse" : "compare"} {entry.comparison_fields.length}
                      </Tag>
                    ) : null}
                  </div>
                }
                description={
                  <Space direction="vertical" size={2} className="history-entry-details">
                    <Typography.Text type="secondary">
                      {entry.payload.collection} · {entry.comparison_fields?.join(" + ") ?? entry.payload.vector_field} · top{" "}
                      {entry.payload.limit}
                    </Typography.Text>
                    <Typography.Text type="secondary">{formatHistoryTime(entry.created_at)}</Typography.Text>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Drawer>
    </section>
  );
};
