import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Collapse,
  Descriptions,
  Divider,
  Input,
  List,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { Play, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { JsonView } from "../components/JsonView";
import { PageToolbar } from "../components/PageToolbar";
import {
  ApiError,
  api,
  type RestProxyPayload,
  type RestProxyResult,
} from "../services/api";
import {
  parseJsonBody,
  parseJsonObject,
  requiresConfirmation,
  restTemplates,
  summarizeResponse,
} from "../services/restConsole";

type RestMethod = RestProxyPayload["method"];

interface HistoryItem {
  id: string;
  method: RestMethod;
  path: string;
  queryText: string;
  bodyText: string;
  createdAt: string;
}

const methods: RestMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const historyKey = "qdrant-admin-rest-history";

const loadHistory = (): HistoryItem[] => {
  try {
    return JSON.parse(localStorage.getItem(historyKey) ?? "[]") as HistoryItem[];
  } catch {
    return [];
  }
};

export const RestConsolePage = () => {
  const { message, modal } = AntApp.useApp();
  const [method, setMethod] = useState<RestMethod>("GET");
  const [path, setPath] = useState("/collections");
  const [queryText, setQueryText] = useState("{}");
  const [bodyText, setBodyText] = useState("{\n  \n}");
  const [response, setResponse] = useState<RestProxyResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory);
  const [templateKey, setTemplateKey] = useState<string | undefined>();

  useEffect(() => {
    localStorage.setItem(historyKey, JSON.stringify(history.slice(0, 12)));
  }, [history]);

  const bodyDisabled = useMemo(() => method === "GET" || method === "HEAD", [method]);
  const selectedTemplate = restTemplates.find((template) => template.key === templateKey);
  const responseSummary = useMemo(() => summarizeResponse(response), [response]);
  const responseHeaders = Object.entries(response?.headers ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  const saveHistory = () => {
    setHistory((current) => [
      {
        id: crypto.randomUUID(),
        method,
        path,
        queryText,
        bodyText,
        createdAt: new Date().toISOString(),
      },
      ...current.filter((item) => !(item.method === method && item.path === path)),
    ]);
  };

  const restMutation = useMutation({
    mutationFn: (payload: RestProxyPayload) => api.restProxy(payload),
    onSuccess: (result) => {
      setResponse(result);
      saveHistory();
      message.success("Request completed.");
    },
    onError: (error) => {
      setResponse({
        status_code: error instanceof ApiError ? error.status : 0,
        headers: {},
        duration_ms: null,
        body:
          error instanceof ApiError
            ? error.detail
            : { detail: { message: error instanceof Error ? error.message : "Request failed." } },
      });
      saveHistory();
      message.error(error instanceof Error ? error.message : "Request failed.");
    },
  });

  const submit = async () => {
    let query: Record<string, unknown>;
    let body: unknown;
    try {
      query = parseJsonObject(queryText, "Query");
      body = bodyDisabled ? undefined : parseJsonBody(bodyText);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Invalid JSON.");
      return;
    }

    const payload: RestProxyPayload = {
      method,
      path,
      query,
      body,
    };

    if (requiresConfirmation(method)) {
      modal.confirm({
        title: `Send ${method} ${path}?`,
        content: "This request may change data in Qdrant.",
        okText: "Send",
        okButtonProps: { danger: method === "DELETE" },
        onOk: () => restMutation.mutateAsync(payload),
      });
      return;
    }

    restMutation.mutate(payload);
  };

  const applyHistory = (item: HistoryItem) => {
    setTemplateKey(undefined);
    setMethod(item.method);
    setPath(item.path);
    setQueryText(item.queryText);
    setBodyText(item.bodyText);
  };

  const applyTemplate = (key: string | undefined) => {
    setTemplateKey(key);
    const template = restTemplates.find((item) => item.key === key);
    if (!template) return;
    setMethod(template.method);
    setPath(template.path);
    setQueryText(template.queryText);
    setBodyText(template.bodyText);
  };

  return (
    <>
      <PageToolbar
        title="REST Console"
        subtitle="Send raw Qdrant REST calls through the local Python proxy."
        actions={
          <Button
            type="primary"
            icon={<Play size={16} />}
            onClick={submit}
            loading={restMutation.isPending}
          >
            Send
          </Button>
        }
      />

      <div className="console-layout">
        <section className="surface console-workbench">
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <div className="console-method-path">
              <Select value={method} onChange={setMethod} options={methods.map((value) => ({ value, label: value }))} />
              <Input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/collections" />
            </div>

            <div>
              <Typography.Text strong>Request template</Typography.Text>
              <Select
                allowClear
                value={templateKey}
                placeholder="Choose a common Qdrant request"
                style={{ width: "100%", marginTop: 6 }}
                onChange={applyTemplate}
                options={restTemplates.map((template) => ({
                  value: template.key,
                  label: template.label,
                }))}
              />
              {selectedTemplate ? (
                <Typography.Paragraph type="secondary" className="template-description">
                  {selectedTemplate.description}
                </Typography.Paragraph>
              ) : null}
            </div>

            <Alert
              type="info"
              showIcon
              message="Only relative Qdrant paths are accepted by the backend proxy."
            />

            <div>
              <Typography.Text strong>Query JSON</Typography.Text>
              <Input.TextArea
                rows={5}
                value={queryText}
                spellCheck={false}
                onChange={(event) => setQueryText(event.target.value)}
              />
            </div>

            <div>
              <Typography.Text strong>Body JSON</Typography.Text>
              <Input.TextArea
                rows={10}
                value={bodyText}
                disabled={bodyDisabled}
                spellCheck={false}
                onChange={(event) => setBodyText(event.target.value)}
              />
            </div>

            <Divider style={{ margin: "6px 0" }} />
            <Space>
              <Button type="primary" icon={<Play size={16} />} onClick={submit} loading={restMutation.isPending}>
                Send
              </Button>
              <Button
                icon={<RotateCcw size={16} />}
                onClick={() => {
                  setMethod("GET");
                  setPath("/collections");
                  setQueryText("{}");
                  setBodyText("{\n  \n}");
                  setTemplateKey(undefined);
                  setResponse(null);
                }}
              >
                Reset
              </Button>
            </Space>

            <Typography.Title level={3}>Response</Typography.Title>
            {response ? (
              <div className="response-summary">
                <div>
                  <Typography.Text type="secondary">HTTP status</Typography.Text>
                  <Tag color={responseSummary.status === "ok" ? "green" : "red"}>
                    {responseSummary.statusCode === 0
                      ? "Network error"
                      : `${responseSummary.statusCode ?? "-"} ${responseSummary.status.toUpperCase()}`}
                  </Tag>
                </div>
                <div>
                  <Typography.Text type="secondary">Upstream time</Typography.Text>
                  <Typography.Text strong>{responseSummary.time}</Typography.Text>
                </div>
                <div>
                  <Typography.Text type="secondary">Content type</Typography.Text>
                  <Typography.Text strong>
                    {response.headers["content-type"] ?? "Unknown"}
                  </Typography.Text>
                </div>
                <div>
                  <Typography.Text type="secondary">Result</Typography.Text>
                  <Typography.Text strong>{responseSummary.result}</Typography.Text>
                </div>
              </div>
            ) : null}
            {responseHeaders.length ? (
              <Collapse
                size="small"
                items={[
                  {
                    key: "response-headers",
                    label: `Response headers (${responseHeaders.length})`,
                    children: (
                      <Descriptions
                        bordered
                        size="small"
                        column={1}
                        items={responseHeaders.map(([name, value]) => ({
                          key: name,
                          label: name,
                          children: <Typography.Text code>{value}</Typography.Text>,
                        }))}
                      />
                    ),
                  },
                ]}
              />
            ) : null}
            <JsonView data={response?.body ?? { ready: true }} minHeight={300} />
          </Space>
        </section>

        <aside className="surface console-history">
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Space style={{ width: "100%", justifyContent: "space-between" }}>
              <Typography.Title level={3}>History</Typography.Title>
              <Button
                icon={<Trash2 size={16} />}
                disabled={!history.length}
                onClick={() => setHistory([])}
              />
            </Space>
            <List
              dataSource={history}
              locale={{ emptyText: "No saved requests yet" }}
              renderItem={(item) => (
                <List.Item>
                  <Button className="history-item" type="text" onClick={() => applyHistory(item)}>
                    <Space direction="vertical" size={2}>
                      <Space>
                        <Tag color={requiresConfirmation(item.method) ? "orange" : "blue"}>{item.method}</Tag>
                        <Typography.Text ellipsis style={{ maxWidth: 188 }}>
                          {item.path}
                        </Typography.Text>
                      </Space>
                      <Typography.Text type="secondary">
                        {new Date(item.createdAt).toLocaleString()}
                      </Typography.Text>
                    </Space>
                  </Button>
                </List.Item>
              )}
            />
          </Space>
        </aside>
      </div>
    </>
  );
};
