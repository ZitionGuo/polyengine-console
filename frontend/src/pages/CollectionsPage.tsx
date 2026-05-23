import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Collapse,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { Eye, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { JsonView } from "../components/JsonView";
import { PageToolbar } from "../components/PageToolbar";
import { api, type CollectionSummary } from "../services/api";
import {
  buildCollectionCreatePayload,
  type CollectionFormValues,
  type PayloadIndexType,
} from "../services/collectionPayload";

type AnyRecord = Record<string, unknown>;

interface VectorRow {
  key: string;
  name: string;
  size: string;
  distance: string;
  onDisk: string;
}

interface PayloadSchemaRow {
  key: string;
  field: string;
  schema: string;
}

const asRecord = (value: unknown): AnyRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : {};

const asNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const unwrapResult = (value: unknown) => asRecord(asRecord(value).result ?? value);

const displayValue = (value: unknown) => {
  if (value === undefined || value === null || value === "") return "Default";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
};

const compactJson = (value: unknown) => {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

const buildVectorRows = (params: AnyRecord): VectorRow[] => {
  const vectors = asRecord(params.vectors);
  if ("size" in vectors || "distance" in vectors) {
    return [
      {
        key: "default",
        name: "default",
        size: displayValue(vectors.size),
        distance: displayValue(vectors.distance),
        onDisk: displayValue(vectors.on_disk),
      },
    ];
  }

  return Object.entries(vectors).map(([name, config]) => {
    const vectorConfig = asRecord(config);
    return {
      key: name,
      name,
      size: displayValue(vectorConfig.size),
      distance: displayValue(vectorConfig.distance),
      onDisk: displayValue(vectorConfig.on_disk),
    };
  });
};

const buildSparseRows = (params: AnyRecord): VectorRow[] =>
  Object.entries(asRecord(params.sparse_vectors)).map(([name, config]) => {
    const sparseConfig = asRecord(config);
    const index = asRecord(sparseConfig.index);
    return {
      key: name,
      name,
      size: "Sparse",
      distance: displayValue(sparseConfig.modifier),
      onDisk: displayValue(index.on_disk),
    };
  });

const buildPayloadRows = (payloadSchema: AnyRecord): PayloadSchemaRow[] =>
  Object.entries(payloadSchema).map(([field, schema]) => ({
    key: field,
    field,
    schema: compactJson(schema),
  }));

const vectorColumns: ColumnsType<VectorRow> = [
  { title: "Name", dataIndex: "name" },
  { title: "Size", dataIndex: "size", width: 120 },
  { title: "Distance / modifier", dataIndex: "distance", width: 170 },
  { title: "On disk", dataIndex: "onDisk", width: 120 },
];

const payloadColumns: ColumnsType<PayloadSchemaRow> = [
  { title: "Field", dataIndex: "field", width: 220 },
  {
    title: "Schema",
    dataIndex: "schema",
    render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
  },
];

const distanceOptions = ["Cosine", "Euclid", "Dot", "Manhattan"].map((value) => ({
  value,
  label: value,
}));

const indexTypeOptions: PayloadIndexType[] = [
  "keyword",
  "integer",
  "float",
  "bool",
  "geo",
  "datetime",
  "text",
  "uuid",
];

const defaultValues: CollectionFormValues = {
  vectorMode: "single",
  singleVector: { size: 384, distance: "Cosine" },
  namedVectors: [{ name: "default", size: 384, distance: "Cosine" }],
  sparseVectors: [],
  indexes: [],
  replicationFactor: 1,
  writeConsistencyFactor: 1,
  onDiskPayload: true,
};

export const CollectionsPage = () => {
  const { message, modal } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [form] = Form.useForm<CollectionFormValues>();
  const vectorMode = Form.useWatch("vectorMode", form) ?? "single";

  const collectionsQuery = useQuery({
    queryKey: ["collections"],
    queryFn: api.listCollections,
  });

  const detailsQuery = useQuery({
    queryKey: ["collections", selectedCollection],
    queryFn: () => api.getCollection(selectedCollection!),
    enabled: Boolean(selectedCollection),
  });

  const createMutation = useMutation({
    mutationFn: async (values: CollectionFormValues) => {
      const { name, body } = buildCollectionCreatePayload(values);
      return api.createCollection(name, body);
    },
    onSuccess: (result) => {
      setCreateOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      if (result.index_errors.length) {
        message.warning("Collection created, but one or more payload indexes failed.");
        return;
      }
      message.success("Collection created.");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "Failed to create collection.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteCollection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      setSelectedCollection(null);
      message.success("Collection deleted.");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "Failed to delete collection.");
    },
  });

  const collections = collectionsQuery.data?.result?.collections ?? [];

  const columns: ColumnsType<CollectionSummary> = [
    {
      title: "Collection",
      dataIndex: "name",
      render: (name: string) => (
        <Space>
          <Typography.Text strong>{name}</Typography.Text>
          <Tag color="green">active</Tag>
        </Space>
      ),
    },
    {
      title: "Actions",
      width: 150,
      align: "right",
      render: (_, record) => (
        <Space>
          <Tooltip title="View details">
            <Button
              aria-label={`View ${record.name}`}
              icon={<Eye size={16} />}
              onClick={() => setSelectedCollection(record.name)}
            />
          </Tooltip>
          <Tooltip title="Delete collection">
            <Button
              danger
              aria-label={`Delete ${record.name}`}
              icon={<Trash2 size={16} />}
              onClick={() =>
                modal.confirm({
                  title: `Delete ${record.name}?`,
                  content: "This removes the collection and its data from Qdrant.",
                  okText: "Delete",
                  okButtonProps: { danger: true },
                  onOk: () => deleteMutation.mutateAsync(record.name),
                })
              }
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageToolbar
        title="Collections"
        subtitle="Create, inspect, index, and remove local Qdrant collections."
        actions={
          <>
            <Tooltip title="Refresh">
              <Button
                icon={<RefreshCw size={16} />}
                onClick={() => collectionsQuery.refetch()}
                loading={collectionsQuery.isFetching}
              />
            </Tooltip>
            <Button
              type="primary"
              icon={<Plus size={16} />}
              onClick={() => {
                form.setFieldsValue(defaultValues);
                setCreateOpen(true);
              }}
            >
              New collection
            </Button>
          </>
        }
      />

      {collectionsQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message="Unable to load collections"
          description={collectionsQuery.error instanceof Error ? collectionsQuery.error.message : undefined}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <div className="surface table-surface">
        <Table
          rowKey="name"
          columns={columns}
          dataSource={collections}
          loading={collectionsQuery.isLoading}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
        />
      </div>

      <Drawer
        title={selectedCollection}
        open={Boolean(selectedCollection)}
        width={760}
        onClose={() => setSelectedCollection(null)}
      >
        {detailsQuery.isLoading ? <Spin /> : null}
        {detailsQuery.isError ? (
          <Alert
            type="error"
            showIcon
            message="Unable to load collection details"
            description={detailsQuery.error instanceof Error ? detailsQuery.error.message : undefined}
          />
        ) : null}
        {detailsQuery.data ? <JsonView data={detailsQuery.data} minHeight={520} /> : null}
      </Drawer>

      <Modal
        title="Create collection"
        open={createOpen}
        width={920}
        okText="Create"
        confirmLoading={createMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => setCreateOpen(false)}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={defaultValues}
          onFinish={(values) => createMutation.mutate(values)}
        >
          <div className="form-grid">
            <Form.Item
              label="Collection name"
              name="name"
              rules={[{ required: true, message: "Collection name is required." }]}
            >
              <Input placeholder="documents" />
            </Form.Item>
            <Form.Item label="Vector mode" name="vectorMode">
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                options={[
                  { label: "Single", value: "single" },
                  { label: "Named", value: "named" },
                ]}
              />
            </Form.Item>
            <Form.Item label="On-disk payload" name="onDiskPayload" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>

          {vectorMode === "single" ? (
            <div className="form-grid">
              <Form.Item
                label="Vector size"
                name={["singleVector", "size"]}
                rules={[{ required: true, message: "Size is required." }]}
              >
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item
                label="Distance"
                name={["singleVector", "distance"]}
                rules={[{ required: true, message: "Distance is required." }]}
              >
                <Select options={distanceOptions} />
              </Form.Item>
              <Form.Item label="Vector on disk" name={["singleVector", "onDisk"]} valuePropName="checked">
                <Switch />
              </Form.Item>
            </div>
          ) : (
            <Form.List name="namedVectors">
              {(fields, { add, remove }) => (
                <div className="dynamic-list">
                  {fields.map((field) => (
                    <div className="form-row" key={field.key}>
                      <Form.Item
                        label="Name"
                        name={[field.name, "name"]}
                        rules={[{ required: true, message: "Name is required." }]}
                      >
                        <Input placeholder="image" />
                      </Form.Item>
                      <Form.Item
                        label="Size"
                        name={[field.name, "size"]}
                        rules={[{ required: true, message: "Size is required." }]}
                      >
                        <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                      </Form.Item>
                      <Form.Item
                        label="Distance"
                        name={[field.name, "distance"]}
                        rules={[{ required: true, message: "Distance is required." }]}
                      >
                        <Select options={distanceOptions} />
                      </Form.Item>
                      <Form.Item label="On disk" name={[field.name, "onDisk"]} valuePropName="checked">
                        <Switch />
                      </Form.Item>
                      <Form.Item label=" ">
                        <Button danger icon={<Trash2 size={16} />} onClick={() => remove(field.name)} />
                      </Form.Item>
                    </div>
                  ))}
                  <Button icon={<Plus size={16} />} onClick={() => add({ size: 384, distance: "Cosine" })}>
                    Add named vector
                  </Button>
                </div>
              )}
            </Form.List>
          )}

          <Divider orientation="left">Replica and shards</Divider>
          <div className="form-grid">
            <Form.Item label="Shard number" name="shardNumber">
              <InputNumber min={1} precision={0} style={{ width: "100%" }} placeholder="Qdrant default" />
            </Form.Item>
            <Form.Item label="Replication factor" name="replicationFactor">
              <InputNumber min={1} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="Write consistency" name="writeConsistencyFactor">
              <InputNumber min={1} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </div>

          <Divider orientation="left">Sparse vectors</Divider>
          <Form.List name="sparseVectors">
            {(fields, { add, remove }) => (
              <div className="dynamic-list">
                {fields.map((field) => (
                  <div className="form-row compact" key={field.key}>
                    <Form.Item label="Name" name={[field.name, "name"]}>
                      <Input placeholder="text-sparse" />
                    </Form.Item>
                    <Form.Item label="Modifier" name={[field.name, "modifier"]}>
                      <Select
                        options={[
                          { value: "none", label: "None" },
                          { value: "idf", label: "IDF" },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item label="On disk" name={[field.name, "onDisk"]} valuePropName="checked">
                      <Switch />
                    </Form.Item>
                    <Form.Item label=" ">
                      <Button danger icon={<Trash2 size={16} />} onClick={() => remove(field.name)} />
                    </Form.Item>
                  </div>
                ))}
                <Button icon={<Plus size={16} />} onClick={() => add({ modifier: "none" })}>
                  Add sparse vector
                </Button>
              </div>
            )}
          </Form.List>

          <Divider orientation="left">Payload indexes</Divider>
          <Form.List name="indexes">
            {(fields, { add, remove }) => (
              <div className="dynamic-list">
                {fields.map((field) => (
                  <div className="form-row compact" key={field.key}>
                    <Form.Item label="Field" name={[field.name, "fieldName"]}>
                      <Input placeholder="metadata.source" />
                    </Form.Item>
                    <Form.Item label="Type" name={[field.name, "type"]}>
                      <Select options={indexTypeOptions.map((value) => ({ value, label: value }))} />
                    </Form.Item>
                    <Form.Item label="On disk" name={[field.name, "onDisk"]} valuePropName="checked">
                      <Switch />
                    </Form.Item>
                    <Form.Item label="Tenant" name={[field.name, "isTenant"]} valuePropName="checked">
                      <Switch />
                    </Form.Item>
                    <Form.Item label=" ">
                      <Button danger icon={<Trash2 size={16} />} onClick={() => remove(field.name)} />
                    </Form.Item>
                    <Form.Item shouldUpdate noStyle>
                      {({ getFieldValue }) => {
                        const type = getFieldValue(["indexes", field.name, "type"]);
                        if (type !== "text") return null;
                        return (
                          <div className="form-row compact">
                            <Form.Item label="Tokenizer" name={[field.name, "tokenizer"]}>
                              <Select
                                options={["word", "whitespace", "prefix", "multilingual"].map((value) => ({
                                  value,
                                  label: value,
                                }))}
                              />
                            </Form.Item>
                            <Form.Item label="Min token" name={[field.name, "minTokenLen"]}>
                              <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                            </Form.Item>
                            <Form.Item label="Max token" name={[field.name, "maxTokenLen"]}>
                              <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                            </Form.Item>
                            <Form.Item label="Lowercase" name={[field.name, "lowercase"]} valuePropName="checked">
                              <Switch />
                            </Form.Item>
                          </div>
                        );
                      }}
                    </Form.Item>
                  </div>
                ))}
                <Button icon={<Plus size={16} />} onClick={() => add({ type: "keyword" })}>
                  Add payload index
                </Button>
              </div>
            )}
          </Form.List>

          <Divider orientation="left">Advanced JSON</Divider>
          <Form.Item name="advancedJson">
            <Input.TextArea
              rows={6}
              spellCheck={false}
              placeholder={'{"hnsw_config":{"m":16},"optimizers_config":{"default_segment_number":2}}'}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};
