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
  Tooltip,
  Typography,
  Upload,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  Ban,
  Download,
  FileWarning,
  FileUp,
  Plus,
  Play,
  RefreshCw,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AdaptiveSelect } from "../components/AdaptiveSelect";
import { IngestErrorDrawer } from "../components/IngestErrorDrawer";
import { PageHeader } from "../components/PageHeader";
import { RetryFailedRowsButton } from "../components/RetryFailedRowsButton";
import {
  api,
  errorMessage,
  type IngestJob,
  type IngestJobPayload,
  type IngestVectorTarget,
  type UploadResult,
} from "../services/api";
import {
  addMissingVectorTargets,
  reconcileVectorTargets,
  suggestTextFields,
} from "../services/ingestMapping";
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
  const [inspectedJobId, setInspectedJobId] = useState<string>();
  const idField = Form.useWatch("id_field", form);
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
      const compatibleFields = (
        schema.data?.vector_fields.filter((field) => field.compatible) ?? []
      ).map((field) => field.name);
      form.setFieldsValue({
        id_field: firstId,
        vector_targets: reconcileVectorTargets(
          compatibleFields,
          result.fields,
          firstId,
          form.getFieldValue("vector_targets"),
        ),
      });
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
  const retry = useMutation({
    mutationFn: api.retryJob,
    onSuccess: () => void cache.invalidateQueries({ queryKey: ["solr", "ingest-jobs"] }),
  });

  const readyCollections = useMemo(
    () => (collections.data?.collections ?? []).filter((item) => item.ready),
    [collections.data],
  );
  const vectorFields = schema.data?.vector_fields.filter((field) => field.compatible) ?? [];
  const inspectedJob = jobs.data?.jobs.find((job) => job.id === inspectedJobId);

  useEffect(() => {
    if (!collection && readyCollections.length) setCollection(readyCollections[0].name);
  }, [collection, readyCollections]);

  useEffect(() => {
    if (!schema.data) return;
    const compatibleFields = schema.data.vector_fields
      .filter((field) => field.compatible)
      .map((field) => field.name);
    form.setFieldsValue({
      collection,
      vector_targets: reconcileVectorTargets(
        compatibleFields,
        uploadResult?.fields ?? [],
        form.getFieldValue("id_field"),
        form.getFieldValue("vector_targets"),
      ),
    });
  }, [collection, form, schema.data, uploadResult?.fields]);

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
          {row.retry_of ? (
            <Tooltip title={`Retry of job ${row.retry_of}`}>
              <Tag className="job-retry-tag" color="blue">Retry</Tag>
            </Tooltip>
          ) : null}
          <Tooltip
            title={row.vector_targets
              .map((target) => `${target.vector_field} <- ${target.text_fields.join(" + ")}`)
              .join("\n")}
          >
            <Tag className="job-vector-targets">
              {row.vector_targets.length} vector {row.vector_targets.length === 1 ? "target" : "targets"}
            </Tag>
          </Tooltip>
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
      width: 208,
      render: (_, job) => (
        <Space>
          {job.status === "queued" || job.status === "running" ? (
            <Popconfirm title="Cancel this ingest job?" onConfirm={() => cancel.mutate(job.id)}>
              <Button type="text" danger icon={<Ban size={15} />} aria-label={`Cancel ${job.filename}`} />
            </Popconfirm>
          ) : null}
          {job.failed ? (
            <Tooltip title="Inspect error rows">
              <Button
                type="text"
                icon={<FileWarning size={15} />}
                aria-label={`Inspect errors for ${job.filename}`}
                onClick={() => setInspectedJobId(job.id)}
              />
            </Tooltip>
          ) : null}
          {job.failed ? (
            <Button
              type="text"
              icon={<Download size={15} />}
              href={api.jobErrorsUrl(job.id)}
              aria-label={`Download errors for ${job.filename}`}
            />
          ) : null}
          <RetryFailedRowsButton
            job={job}
            loading={retry.isPending && retry.variables === job.id}
            onRetry={(jobId) => retry.mutate(jobId)}
          />
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
                onChange={(value) => {
                  form.setFieldValue("vector_targets", []);
                  setCollection(value);
                }}
              />
            </Form.Item>
            <Form.Item name="id_field" label="Document ID" rules={[{ required: true }]}>
              <Select
                disabled={!uploadResult}
                options={uploadResult?.fields.map((fieldName) => ({ label: fieldName, value: fieldName }))}
                placeholder="Source ID field"
                onChange={(value) => {
                  form.setFieldValue(
                    "vector_targets",
                    reconcileVectorTargets(
                      vectorFields.map((field) => field.name),
                      uploadResult?.fields ?? [],
                      value,
                      form.getFieldValue("vector_targets"),
                    ),
                  );
                }}
              />
            </Form.Item>
            <Form.List
              name="vector_targets"
              rules={[
                {
                  validator: async (_, targets: IngestVectorTarget[] | undefined) => {
                    if (!targets?.length) throw new Error("Add at least one vector target.");
                    const names = targets.map((target) => target?.vector_field).filter(Boolean);
                    if (new Set(names).size !== names.length) {
                      throw new Error("Each vector field can be mapped only once.");
                    }
                  },
                },
              ]}
            >
              {(fields, { add, remove }, { errors }) => {
                const selected = new Set(
                  (form.getFieldValue("vector_targets") as IngestVectorTarget[] | undefined)
                    ?.map((target) => target?.vector_field)
                    .filter(Boolean),
                );
                const nextVector = vectorFields.find((field) => !selected.has(field.name));
                return (
                  <div className="vector-target-builder">
                    <div className="vector-target-heading">
                      <div>
                        <Typography.Text strong>Vector targets</Typography.Text>
                        <Typography.Text type="secondary">
                          Map each Solr vector field to its own source text.
                        </Typography.Text>
                      </div>
                      <Space size={6} wrap>
                        {vectorFields.length > 1 ? (
                          <Button
                            size="small"
                            onClick={() =>
                              form.setFieldValue(
                                "vector_targets",
                                addMissingVectorTargets(
                                  vectorFields.map((field) => field.name),
                                  uploadResult?.fields ?? [],
                                  idField,
                                  form.getFieldValue("vector_targets"),
                                ),
                              )}
                          >
                            Add all
                          </Button>
                        ) : null}
                        <Button
                          size="small"
                          icon={<Plus size={14} />}
                          disabled={!nextVector}
                          onClick={() => {
                            if (!nextVector) return;
                            add({
                              vector_field: nextVector.name,
                              text_fields: suggestTextFields(
                                nextVector.name,
                                uploadResult?.fields ?? [],
                                idField,
                              ),
                            });
                          }}
                        >
                          Add target
                        </Button>
                      </Space>
                    </div>

                    {fields.map(({ key, ...field }, index) => (
                      <div className="vector-target-row" key={key}>
                        <Form.Item
                          {...field}
                          name={[field.name, "vector_field"]}
                          label={`Vector field ${index + 1}`}
                          rules={[{ required: true, message: "Select a vector field." }]}
                        >
                          <Select
                            options={vectorFields.map((item) => ({
                              label: item.name,
                              value: item.name,
                            }))}
                            placeholder="Solr vector field"
                            onChange={(value) =>
                              form.setFieldValue(
                                ["vector_targets", field.name, "text_fields"],
                                suggestTextFields(
                                  value,
                                  uploadResult?.fields ?? [],
                                  idField,
                                ),
                              )}
                          />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          name={[field.name, "text_fields"]}
                          label="Source text fields"
                          rules={[
                            {
                              required: true,
                              type: "array",
                              min: 1,
                              message: "Select at least one source field.",
                            },
                          ]}
                        >
                          <Select
                            mode="multiple"
                            disabled={!uploadResult}
                            options={uploadResult?.fields
                              .filter((fieldName) => fieldName !== idField)
                              .map((fieldName) => ({ label: fieldName, value: fieldName }))}
                            placeholder="Fields to concatenate and embed"
                            maxTagCount="responsive"
                          />
                        </Form.Item>
                        <Tooltip title="Remove vector target">
                          <Button
                            className="vector-target-remove"
                            type="text"
                            danger
                            icon={<Trash2 size={16} />}
                            aria-label={`Remove vector target ${index + 1}`}
                            disabled={fields.length === 1}
                            onClick={() => remove(field.name)}
                          />
                        </Tooltip>
                      </div>
                    ))}
                    <Form.ErrorList errors={errors} />
                  </div>
                );
              }}
            </Form.List>
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
        {retry.isError ? (
          <Alert
            type="error"
            showIcon
            message="Unable to retry failed rows"
            description={errorMessage(retry.error)}
          />
        ) : null}
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
      <IngestErrorDrawer
        job={inspectedJob}
        open={Boolean(inspectedJobId)}
        retrying={retry.isPending && retry.variables === inspectedJobId}
        onRetry={(jobId) => retry.mutate(jobId)}
        onClose={() => setInspectedJobId(undefined)}
      />
    </section>
  );
};
