import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Empty,
  Form,
  InputNumber,
  Popconfirm,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { Ban, Download, FileUp, Play, RefreshCw, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AdaptiveSelect } from "../components/AdaptiveSelect";
import { PageHeader } from "../components/PageHeader";
import {
  api,
  errorMessage,
  type IngestJob,
  type IngestJobPayload,
  type UploadResult,
} from "../services/api";
import { selectedCollection } from "../services/navigation";

type JobForm = Omit<IngestJobPayload, "upload_id">;

const statusColor: Record<IngestJob["status"], string> = {
  queued: "default",
  running: "processing",
  completed: "success",
  cancelled: "warning",
  failed: "error",
};

export const IngestPage = () => {
  const [form] = Form.useForm<JobForm>();
  const cache = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [collection, setCollection] = useState(selectedCollection());
  const collections = useQuery({ queryKey: ["solr", "collections"], queryFn: api.collections });
  const schema = useQuery({
    queryKey: ["solr", "schema", collection],
    queryFn: () => api.schema(collection),
    enabled: Boolean(collection),
  });
  const jobs = useQuery({
    queryKey: ["solr", "ingest-jobs"],
    queryFn: api.jobs,
    refetchInterval: (query) =>
      query.state.data?.jobs.some((job) => job.status === "queued" || job.status === "running") ? 1000 : false,
  });
  const upload = useMutation({
    mutationFn: api.upload,
    onSuccess: (result) => {
      setUploadResult(result);
      const firstId = result.fields.find((fieldName) => fieldName === "id") ?? result.fields[0];
      form.setFieldsValue({ id_field: firstId });
    },
  });
  const createJob = useMutation({
    mutationFn: api.createJob,
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["solr", "ingest-jobs"] });
      setFile(null);
      setUploadResult(null);
    },
  });
  const cancel = useMutation({
    mutationFn: api.cancelJob,
    onSuccess: () => void cache.invalidateQueries({ queryKey: ["solr", "ingest-jobs"] }),
  });

  const readyCollections = useMemo(
    () => (collections.data?.collections ?? []).filter((item) => item.ready),
    [collections.data],
  );
  const vectorFields = schema.data?.vector_fields.filter((field) => field.compatible) ?? [];

  useEffect(() => {
    if (!collection && readyCollections.length) setCollection(readyCollections[0].name);
  }, [collection, readyCollections]);

  useEffect(() => {
    if (!schema.data) return;
    form.setFieldsValue({
      collection,
      vector_field: schema.data.vector_fields.find((field) => field.compatible)?.name,
    });
  }, [collection, form, schema.data]);

  const startJob = (values: JobForm) => {
    if (!uploadResult) return;
    createJob.mutate({ ...values, upload_id: uploadResult.upload_id });
  };

  const previewColumns: ColumnsType<Record<string, unknown>> = (uploadResult?.fields ?? []).slice(0, 6).map((fieldName) => ({
    title: fieldName,
    dataIndex: fieldName,
    key: fieldName,
    ellipsis: true,
    render: (value: unknown) => (typeof value === "object" ? JSON.stringify(value) : String(value ?? "")),
  }));

  const jobColumns: ColumnsType<IngestJob> = [
    {
      title: "File",
      dataIndex: "filename",
      key: "filename",
      render: (value: string, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{value}</Typography.Text>
          <Typography.Text type="secondary">{row.collection}</Typography.Text>
        </Space>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (status: IngestJob["status"]) => <Tag color={statusColor[status]}>{status}</Tag>,
    },
    {
      title: "Progress",
      key: "progress",
      width: 280,
      render: (_, job) => {
        const percent = job.total ? Math.round((job.processed / job.total) * 100) : 0;
        return (
          <Space direction="vertical" size={2} className="job-progress">
            <Progress percent={percent} size="small" status={job.status === "failed" ? "exception" : undefined} />
            <Typography.Text type="secondary">
              {job.succeeded.toLocaleString()} written · {job.failed.toLocaleString()} failed
            </Typography.Text>
          </Space>
        );
      },
    },
    {
      title: "Rate",
      dataIndex: "throughput",
      key: "rate",
      width: 110,
      render: (value?: number | null) => (value ? `${value.toFixed(1)}/s` : "—"),
    },
    {
      title: "Actions",
      key: "actions",
      width: 150,
      render: (_, job) => (
        <Space>
          {job.status === "queued" || job.status === "running" ? (
            <Popconfirm title="Cancel this ingest job?" onConfirm={() => cancel.mutate(job.id)}>
              <Button type="text" danger icon={<Ban size={15} />} aria-label={`Cancel ${job.filename}`} />
            </Popconfirm>
          ) : null}
          {job.failed ? (
            <Button
              type="text"
              icon={<Download size={15} />}
              href={api.jobErrorsUrl(job.id)}
              aria-label={`Download errors for ${job.filename}`}
            />
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <section>
      <PageHeader
        title="Ingest"
        description="Upload source documents, map existing Solr fields, and generate document embeddings in the background."
        actions={
          <Button icon={<RefreshCw size={16} />} loading={jobs.isFetching} onClick={() => jobs.refetch()}>
            Refresh jobs
          </Button>
        }
      />
      <div className="ingest-layout">
        <div className="surface upload-panel">
          <div className="panel-heading compact">
            <div>
              <Typography.Title level={3}>1. Source file</Typography.Title>
              <Typography.Text type="secondary">JSON array, JSONL, or CSV up to 100 MB</Typography.Text>
            </div>
          </div>
          <Upload.Dragger
            accept=".json,.jsonl,.ndjson,.csv"
            maxCount={1}
            fileList={file ? [file as never] : []}
            beforeUpload={(nextFile) => {
              setFile(nextFile);
              setUploadResult(null);
              return false;
            }}
            onRemove={() => {
              setFile(null);
              setUploadResult(null);
            }}
          >
            <UploadCloud size={28} />
            <Typography.Text strong>Drop a document file here</Typography.Text>
            <Typography.Text type="secondary">or select one from this computer</Typography.Text>
          </Upload.Dragger>
          {upload.isError ? <Alert type="error" showIcon message="Upload failed" description={errorMessage(upload.error)} /> : null}
          <Button
            icon={<FileUp size={16} />}
            disabled={!file || Boolean(uploadResult)}
            loading={upload.isPending}
            onClick={() => file && upload.mutate(file)}
          >
            Inspect file
          </Button>
        </div>

        <div className="surface mapping-panel">
          <div className="panel-heading compact">
            <div>
              <Typography.Title level={3}>2. Field mapping</Typography.Title>
              <Typography.Text type="secondary">The target schema is never modified</Typography.Text>
            </div>
          </div>
          <Form<JobForm>
            form={form}
            layout="vertical"
            initialValues={{ batch_size: 64, commit_within_ms: 1000 }}
            onFinish={startJob}
          >
            <Form.Item name="collection" label="Collection" rules={[{ required: true }]}>
              <AdaptiveSelect
                options={readyCollections.map((item) => ({ label: item.name, value: item.name }))}
                placeholder="Select collection"
                onChange={setCollection}
              />
            </Form.Item>
            <div className="form-grid two">
              <Form.Item name="id_field" label="Document ID" rules={[{ required: true }]}>
                <Select
                  disabled={!uploadResult}
                  options={uploadResult?.fields.map((fieldName) => ({ label: fieldName, value: fieldName }))}
                  placeholder="Source ID field"
                />
              </Form.Item>
              <Form.Item name="vector_field" label="Vector field" rules={[{ required: true }]}>
                <AdaptiveSelect
                  options={vectorFields.map((field) => ({ label: field.name, value: field.name }))}
                  placeholder="Solr vector field"
                />
              </Form.Item>
            </div>
            <Form.Item name="text_fields" label="Text fields" rules={[{ required: true }]}>
              <Select
                mode="multiple"
                disabled={!uploadResult}
                options={uploadResult?.fields.map((fieldName) => ({ label: fieldName, value: fieldName }))}
                placeholder="Fields to concatenate and embed"
              />
            </Form.Item>
            <div className="form-grid two">
              <Form.Item name="batch_size" label="Embedding batch">
                <InputNumber min={1} max={256} className="full-width" />
              </Form.Item>
              <Form.Item name="commit_within_ms" label="Commit within (ms)">
                <InputNumber min={0} max={60_000} className="full-width" />
              </Form.Item>
            </div>
            {createJob.isError ? (
              <Alert type="error" showIcon message="Unable to start job" description={errorMessage(createJob.error)} />
            ) : null}
            <Button
              type="primary"
              htmlType="submit"
              icon={<Play size={16} />}
              disabled={!uploadResult || !vectorFields.length}
              loading={createJob.isPending}
            >
              Start ingest job
            </Button>
          </Form>
        </div>
      </div>

      {uploadResult ? (
        <div className="surface preview-panel">
          <div className="panel-heading compact">
            <div>
              <Typography.Title level={3}>File preview</Typography.Title>
              <Typography.Text type="secondary">
                {uploadResult.total.toLocaleString()} documents · {(uploadResult.size / 1024).toFixed(1)} KB · {uploadResult.format.toUpperCase()}
              </Typography.Text>
            </div>
          </div>
          <Table
            rowKey={(record) => String(record.id ?? record._version_ ?? JSON.stringify(record))}
            size="small"
            columns={previewColumns}
            dataSource={uploadResult.preview.slice(0, 8)}
            pagination={false}
            scroll={{ x: 720 }}
          />
        </div>
      ) : null}

      <div className="surface jobs-panel">
        <div className="panel-heading compact">
          <div>
            <Typography.Title level={3}>Ingest jobs</Typography.Title>
            <Typography.Text type="secondary">Only one embedding job runs at a time on this local worker</Typography.Text>
          </div>
        </div>
        <Table
          rowKey="id"
          columns={jobColumns}
          dataSource={jobs.data?.jobs ?? []}
          loading={jobs.isLoading}
          pagination={{ pageSize: 8, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty description="No ingest jobs yet" /> }}
          scroll={{ x: 900 }}
        />
      </div>
    </section>
  );
};
