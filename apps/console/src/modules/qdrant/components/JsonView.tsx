import { App as AntApp, Button, Space, Tag, Tooltip, Typography } from "antd";
import { Check, Clipboard } from "lucide-react";
import { useMemo, useState } from "react";

interface JsonViewProps {
  data: unknown;
  minHeight?: number;
}

export const stringifyJson = (data: unknown) => {
  if (data === undefined) return "undefined";
  try {
    const formatted = JSON.stringify(data, null, 2);
    return formatted ?? String(data);
  } catch {
    return String(data);
  }
};

export const describeJsonValue = (data: unknown) => {
  if (Array.isArray(data)) {
    return { kind: "Array", detail: `${data.length} item${data.length === 1 ? "" : "s"}` };
  }
  if (data === null) {
    return { kind: "Null", detail: "empty value" };
  }
  if (typeof data === "object") {
    const keyCount = Object.keys(data as Record<string, unknown>).length;
    return { kind: "Object", detail: `${keyCount} key${keyCount === 1 ? "" : "s"}` };
  }
  return { kind: typeof data, detail: "scalar value" };
};

const formatBytes = (text: string) => {
  const bytes = new Blob([text]).size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const copyText = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.inset = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Copy command failed.");
    }
  } finally {
    document.body.removeChild(textarea);
  }
};

export const JsonView = ({ data, minHeight = 180 }: JsonViewProps) => {
  const { message } = AntApp.useApp();
  const [copied, setCopied] = useState(false);
  const jsonText = useMemo(() => stringifyJson(data), [data]);
  const summary = useMemo(() => describeJsonValue(data), [data]);

  const copyJson = async () => {
    try {
      await copyText(jsonText);
      setCopied(true);
      message.success("JSON copied.");
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      message.error("Unable to copy JSON.");
    }
  };

  return (
    <div className="json-view">
      <div className="json-view-toolbar">
        <Space size={8} wrap>
          <Tag color="blue">{summary.kind}</Tag>
          <Typography.Text type="secondary">{summary.detail}</Typography.Text>
          <Typography.Text type="secondary">{formatBytes(jsonText)}</Typography.Text>
        </Space>
        <Tooltip title="Copy JSON">
          <Button
            size="small"
            aria-label="Copy JSON"
            icon={copied ? <Check size={14} /> : <Clipboard size={14} />}
            onClick={copyJson}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </Tooltip>
      </div>
      <pre className="json-view-code" style={{ minHeight }}>
        {jsonText}
      </pre>
    </div>
  );
};
