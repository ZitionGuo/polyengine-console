import { Collapse, Descriptions, Drawer, Space, Tag, Typography } from "antd";
import type { ReactNode } from "react";

import type { RelevanceJudgment } from "../services/relevance";
import { RelevanceButtons } from "./RelevanceButtons";

interface DocumentInspectorProps {
  document?: Record<string, unknown>;
  judgment?: RelevanceJudgment;
  open: boolean;
  rank?: number;
  scoreLabel?: string;
  vectorField?: string;
  onJudgmentChange?: (value?: RelevanceJudgment) => void;
  onClose: () => void;
}

const scalarText = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
};

export const documentDisplayTitle = (document: Record<string, unknown>) => {
  const value = document.title ?? document.name ?? document.id ?? "Untitled document";
  return scalarText(Array.isArray(value) ? value[0] : value);
};

const renderObject = (value: Record<string, unknown>): ReactNode => (
  <dl className="document-object">
    {Object.entries(value).map(([key, item]) => (
      <div key={key}>
        <dt>{key}</dt>
        <dd>{renderDocumentValue(item)}</dd>
      </div>
    ))}
  </dl>
);

export const renderDocumentValue = (value: unknown): ReactNode => {
  if (Array.isArray(value)) {
    if (!value.length) return <Typography.Text type="secondary">Empty list</Typography.Text>;
    const compact = value.length <= 10 && value.every((item) => typeof item !== "object" && scalarText(item).length <= 36);
    if (compact) {
      return (
        <Space size={[4, 4]} wrap>
          {value.map((item, index) => <Tag key={`${scalarText(item)}-${index}`}>{scalarText(item)}</Tag>)}
        </Space>
      );
    }
    return (
      <Space direction="vertical" size={6} className="document-value-list">
        {value.map((item, index) => (
          <Typography.Paragraph key={index}>{typeof item === "object" && item !== null ? renderObject(item) : scalarText(item)}</Typography.Paragraph>
        ))}
      </Space>
    );
  }
  if (typeof value === "boolean") return <Tag color={value ? "green" : "default"}>{value ? "True" : "False"}</Tag>;
  if (typeof value === "object" && value !== null) return renderObject(value as Record<string, unknown>);
  if (typeof value === "string" && value.length > 100) {
    return <Typography.Paragraph className="document-long-text">{value}</Typography.Paragraph>;
  }
  return <Typography.Text>{scalarText(value)}</Typography.Text>;
};

const renderDocumentField = (key: string, value: unknown): ReactNode => {
  if ((key === "title" || key === "name") && Array.isArray(value)) {
    return renderDocumentValue(value[0]);
  }
  if (["body", "content", "description", "text"].includes(key) && Array.isArray(value)) {
    return (
      <Space direction="vertical" size={8} className="document-value-list">
        {value.map((item, index) => (
          <Typography.Paragraph key={index} className="document-long-text">
            {typeof item === "object" && item !== null ? renderObject(item) : scalarText(item)}
          </Typography.Paragraph>
        ))}
      </Space>
    );
  }
  return renderDocumentValue(value);
};

export const DocumentInspector = ({
  document,
  judgment,
  open,
  rank,
  scoreLabel = "Score",
  vectorField,
  onJudgmentChange,
  onClose,
}: DocumentInspectorProps) => {
  const entries = document
    ? Object.entries(document)
      .filter(([key]) => key !== "score" && !key.startsWith("_"))
      .sort(([left], [right]) => {
        const priority = (key: string) => (key === "id" ? 0 : key === "title" ? 1 : 2);
        return priority(left) - priority(right);
      })
    : [];
  const score = document?.score;

  return (
    <Drawer
      title={document ? documentDisplayTitle(document) : "Document"}
      open={open}
      onClose={onClose}
      width="min(620px, 100vw)"
      className="document-inspector"
    >
      {document ? (
        <>
          <Space size={[6, 6]} wrap className="document-inspector-meta">
            {rank !== undefined ? <Tag color="blue">Rank {rank}</Tag> : null}
            {typeof score === "number" ? <Tag>{scoreLabel} {score.toFixed(5)}</Tag> : null}
            {vectorField ? <Tag>{vectorField}</Tag> : null}
            {onJudgmentChange ? (
              <RelevanceButtons
                label={documentDisplayTitle(document)}
                value={judgment}
                onChange={onJudgmentChange}
              />
            ) : null}
          </Space>
          <Descriptions
            className="document-fields"
            column={1}
            size="small"
            colon={false}
            items={entries.map(([key, value]) => ({
              key,
              label: key,
              children: renderDocumentField(key, value),
            }))}
          />
          <Collapse
            ghost
            className="document-raw"
            items={[
              {
                key: "raw",
                label: "Raw document JSON",
                children: <pre className="json-block">{JSON.stringify(document, null, 2)}</pre>,
              },
            ]}
          />
        </>
      ) : null}
    </Drawer>
  );
};
