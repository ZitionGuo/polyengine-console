import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { Edit3, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { PageToolbar } from "../components/PageToolbar";
import { api, type AliasSummary } from "../services/api";
import {
  buildAliasUpdatePayload,
  type AliasEditValues,
} from "../services/aliases";

interface AliasFormValues {
  collectionName: string;
  aliasName: string;
}

export const AliasesPage = () => {
  const { message, modal } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingAlias, setEditingAlias] = useState<AliasSummary | null>(null);
  const [createForm] = Form.useForm<AliasFormValues>();
  const [editForm] = Form.useForm<AliasEditValues>();

  const aliasesQuery = useQuery({
    queryKey: ["qdrant", "aliases"],
    queryFn: api.listAliases,
  });

  const collectionsQuery = useQuery({
    queryKey: ["qdrant", "collections"],
    queryFn: api.listCollections,
  });

  const invalidateAliases = () => {
    queryClient.invalidateQueries({ queryKey: ["qdrant", "aliases"] });
    queryClient.invalidateQueries({ queryKey: ["qdrant", "collections"] });
  };

  const createMutation = useMutation({
    mutationFn: (values: AliasFormValues) => api.createAlias(values.collectionName, values.aliasName),
    onSuccess: () => {
      setCreateOpen(false);
      createForm.resetFields();
      invalidateAliases();
      message.success("Alias created.");
    },
    onError: (error) => message.error(error instanceof Error ? error.message : "Failed to create alias."),
  });

  const updateMutation = useMutation({
    mutationFn: ({ alias, values }: { alias: AliasSummary; values: AliasEditValues }) =>
      api.updateAlias(alias.alias_name, buildAliasUpdatePayload(alias, values)),
    onSuccess: () => {
      setEditingAlias(null);
      editForm.resetFields();
      invalidateAliases();
      message.success("Alias updated.");
    },
    onError: (error) => message.error(error instanceof Error ? error.message : "Failed to update alias."),
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteAlias,
    onSuccess: () => {
      invalidateAliases();
      message.success("Alias deleted.");
    },
    onError: (error) => message.error(error instanceof Error ? error.message : "Failed to delete alias."),
  });

  const aliases = aliasesQuery.data?.result?.aliases ?? [];
  const collectionOptions =
    collectionsQuery.data?.result?.collections.map((collection) => ({
      value: collection.name,
      label: collection.name,
    })) ?? [];

  const columns: ColumnsType<AliasSummary> = [
    {
      title: "Alias",
      dataIndex: "alias_name",
      render: (value: string) => <Typography.Text strong>{value}</Typography.Text>,
    },
    {
      title: "Collection",
      dataIndex: "collection_name",
    },
    {
      title: "Actions",
      width: 140,
      align: "right",
      render: (_, record) => (
        <Space>
          <Tooltip title="Edit alias">
            <Button
              aria-label={`Edit ${record.alias_name}`}
              icon={<Edit3 size={16} />}
              onClick={() => {
                setEditingAlias(record);
                editForm.setFieldsValue({
                  aliasName: record.alias_name,
                  collectionName: record.collection_name,
                });
              }}
            />
          </Tooltip>
          <Tooltip title="Delete alias">
            <Button
              danger
              icon={<Trash2 size={16} />}
              onClick={() =>
                modal.confirm({
                  title: `Delete alias ${record.alias_name}?`,
                  content: `Collection ${record.collection_name} will remain untouched.`,
                  okText: "Delete",
                  okButtonProps: { danger: true },
                  onOk: () => deleteMutation.mutateAsync(record.alias_name),
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
        title="Aliases"
        subtitle="Map stable names to collections and update routing atomically."
        actions={
          <>
            <Tooltip title="Refresh">
              <Button
                icon={<RefreshCw size={16} />}
                loading={aliasesQuery.isFetching}
                onClick={() => aliasesQuery.refetch()}
              />
            </Tooltip>
            <Button type="primary" icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
              New alias
            </Button>
          </>
        }
      />

      {aliasesQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message="Unable to load aliases"
          description={aliasesQuery.error instanceof Error ? aliasesQuery.error.message : undefined}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <div className="surface table-surface">
        <Table
          rowKey="alias_name"
          columns={columns}
          dataSource={aliases}
          loading={aliasesQuery.isLoading}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
        />
      </div>

      <Modal
        title="Create alias"
        open={createOpen}
        okText="Create"
        confirmLoading={createMutation.isPending}
        onOk={() => createForm.submit()}
        onCancel={() => setCreateOpen(false)}
      >
        <Form form={createForm} layout="vertical" onFinish={(values) => createMutation.mutate(values)}>
          <Form.Item
            label="Collection"
            name="collectionName"
            rules={[{ required: true, message: "Collection is required." }]}
          >
            <Select options={collectionOptions} showSearch placeholder="Select collection" />
          </Form.Item>
          <Form.Item
            label="Alias"
            name="aliasName"
            rules={[{ required: true, whitespace: true, message: "Alias is required." }]}
          >
            <Input placeholder="documents_live" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Edit ${editingAlias?.alias_name ?? "alias"}`}
        open={Boolean(editingAlias)}
        okText="Save changes"
        confirmLoading={updateMutation.isPending}
        onOk={() => editForm.submit()}
        onCancel={() => setEditingAlias(null)}
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(values) => {
            if (!editingAlias) return;
            updateMutation.mutate({ alias: editingAlias, values });
          }}
        >
          <Form.Item
            label="Alias"
            name="aliasName"
            rules={[{ required: true, whitespace: true, message: "Alias is required." }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            label="Collection"
            name="collectionName"
            rules={[{ required: true, message: "Collection is required." }]}
          >
            <Select
              options={collectionOptions}
              showSearch
              optionFilterProp="label"
              placeholder="Select collection"
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};
