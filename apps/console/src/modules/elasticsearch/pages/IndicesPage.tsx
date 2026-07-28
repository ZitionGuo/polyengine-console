import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { ArrowRight, Boxes, Database, RefreshCw } from "lucide-react";
import { useState } from "react";

import {
  api,
  errorMessage,
  type IndexSummary,
  type VectorField,
} from "../services/api";

const healthStatus = (health?: string) => {
  if (health === "green") return "success";
  if (health === "yellow") return "warning";
  if (health === "red") return "error";
  return "default";
};

const VectorFieldTag = ({ field }: { field: VectorField }) => (
  <Tooltip title={field.reason ?? `${field.type} · ${field.dimension ?? "managed"} dimensions`}>
    <Tag color={field.compatible ? "blue" : "default"}>{field.name}</Tag>
  </Tooltip>
);

export const IndicesPage = () => {
  const [selected, setSelected] = useState<IndexSummary | null>(null);
  const indices = useQuery({
    queryKey: ["elasticsearch", "indices"],
    queryFn: api.indices,
  });

  const columns: ColumnsType<IndexSummary> = [
    {
      title: "Index",
      dataIndex: "name",
      key: "name",
      render: (name: string, row) => (
        <button className="es-index-link" type="button" onClick={() => setSelected(row)}>
          <Database size={15} />
          <span>{name}</span>
        </button>
      ),
    },
    {
      title: "Health",
      dataIndex: "health",
      key: "health",
      width: 110,
      render: (health: string) => <Badge status={healthStatus(health)} text={health ?? "unknown"} />,
    },
    {
      title: "Documents",
      dataIndex: "document_count",
      key: "document_count",
      width: 120,
      align: "right",
      render: (count: number | null) => count?.toLocaleString() ?? "—",
    },
    {
      title: "Store",
      dataIndex: "store_size",
      key: "store_size",
      width: 100,
      align: "right",
      render: (value: string) => value ?? "—",
    },
    {
      title: "Vector fields",
      dataIndex: "vector_fields",
      key: "vector_fields",
      render: (fields: VectorField[]) =>
        fields.length ? (
          <Space size={[4, 4]} wrap>
            {fields.slice(0, 4).map((field) => <VectorFieldTag field={field} key={field.name} />)}
            {fields.length > 4 ? <Tag>+{fields.length - 4}</Tag> : null}
          </Space>
        ) : (
          <Typography.Text type="secondary">None</Typography.Text>
        ),
    },
    {
      title: "Search ready",
      dataIndex: "ready",
      key: "ready",
      width: 120,
      render: (ready: boolean) => (
        <Tag color={ready ? "success" : "default"}>{ready ? "Ready" : "Needs setup"}</Tag>
      ),
    },
    {
      title: "",
      key: "actions",
      width: 46,
      render: (_, row) => (
        <Tooltip title="Inspect mapping">
          <Button
            type="text"
            icon={<ArrowRight size={16} />}
            aria-label={`Inspect ${row.name}`}
            onClick={() => setSelected(row)}
          />
        </Tooltip>
      ),
    },
  ];

  return (
    <div className="es-page">
      <div className="es-page-header">
        <div>
          <Typography.Text className="page-eyebrow">ELASTICSEARCH</Typography.Text>
          <Typography.Title level={2}>Indices</Typography.Title>
          <Typography.Text type="secondary">
            Discover indexed vector fields and their search compatibility.
          </Typography.Text>
        </div>
        <Button
          icon={<RefreshCw size={16} />}
          loading={indices.isFetching}
          onClick={() => void indices.refetch()}
        >
          Refresh
        </Button>
      </div>

      {indices.isPending ? (
        <div className="surface es-loading"><Skeleton active paragraph={{ rows: 7 }} /></div>
      ) : indices.isError ? (
        <Alert
          type="error"
          showIcon
          message="Elasticsearch indices are unavailable"
          description={errorMessage(indices.error)}
        />
      ) : (
        <section className="surface es-index-surface">
          <div className="es-surface-heading">
            <div>
              <Typography.Title level={4}>Searchable indices</Typography.Title>
              <Typography.Text type="secondary">
                Local Qwen embeddings require a {indices.data.model_dimension}-dimension dense vector.
              </Typography.Text>
            </div>
            <Tag icon={<Boxes size={13} />}>{indices.data.indices.length} indices</Tag>
          </div>
          <Table
            rowKey="name"
            columns={columns}
            dataSource={indices.data.indices}
            pagination={{ pageSize: 12, hideOnSinglePage: true }}
            scroll={{ x: 860 }}
            locale={{ emptyText: <Empty description="No user indices found" /> }}
          />
        </section>
      )}

      <Drawer
        width={560}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.name}
        className="es-schema-drawer"
      >
        {selected ? (
          <>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="Health">{selected.health ?? "Unknown"}</Descriptions.Item>
              <Descriptions.Item label="Status">{selected.status ?? "Unknown"}</Descriptions.Item>
              <Descriptions.Item label="Documents">
                {selected.document_count?.toLocaleString() ?? "Unknown"}
              </Descriptions.Item>
              <Descriptions.Item label="Store">{selected.store_size ?? "Unknown"}</Descriptions.Item>
              <Descriptions.Item label="Aliases" span={2}>
                {selected.aliases.length ? selected.aliases.join(", ") : "None"}
              </Descriptions.Item>
            </Descriptions>

            <Typography.Title level={4} className="es-drawer-section-title">
              Vector fields
            </Typography.Title>
            {selected.vector_fields.length ? (
              <div className="es-field-list">
                {selected.vector_fields.map((field) => (
                  <div className="es-field-row" key={field.name}>
                    <div>
                      <Typography.Text strong>{field.name}</Typography.Text>
                      <Typography.Text type="secondary">
                        {field.type} · {field.dimension ?? "managed"} dims · {field.similarity ?? "default"}
                      </Typography.Text>
                    </div>
                    <Tag color={field.compatible ? "success" : "default"}>
                      {field.compatible ? "Searchable" : "Unavailable"}
                    </Tag>
                    {field.reason ? <Typography.Text type="danger">{field.reason}</Typography.Text> : null}
                  </div>
                ))}
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No vector fields" />
            )}
          </>
        ) : null}
      </Drawer>
    </div>
  );
};
