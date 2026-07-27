import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Empty, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ArrowRight, RefreshCw } from "lucide-react";

import { PageHeader } from "../components/PageHeader";
import { api, errorMessage, type CollectionSummary } from "../services/api";
import { selectCollection, type PageKey } from "../services/navigation";

const openPage = (collection: string, page: PageKey) => {
  selectCollection(collection);
  window.dispatchEvent(new CustomEvent("solr:navigate", { detail: page }));
};

export const CollectionsPage = () => {
  const collections = useQuery({ queryKey: ["solr", "collections"], queryFn: api.collections });

  const columns: ColumnsType<CollectionSummary> = [
    {
      title: "Collection",
      dataIndex: "name",
      key: "name",
      render: (name: string) => <Typography.Text strong>{name}</Typography.Text>,
    },
    {
      title: "Documents",
      dataIndex: "document_count",
      key: "documents",
      width: 130,
      sorter: (a, b) => (a.document_count ?? -1) - (b.document_count ?? -1),
      render: (value?: number | null) => value?.toLocaleString() ?? "Unavailable",
    },
    {
      title: "Vector fields",
      key: "vectors",
      render: (_, row) =>
        row.vector_fields.length ? (
          <Space size={[6, 6]} wrap>
            {row.vector_fields.map((field) => (
              <Tooltip key={field.name} title={field.reason ?? `${field.similarity_function} / ${field.vector_encoding}`}>
                <Tag color={field.compatible ? "blue" : "default"}>
                  {field.name} · {field.dimension ?? "?"}d
                </Tag>
              </Tooltip>
            ))}
          </Space>
        ) : (
          <Typography.Text type="secondary">No dense vector fields</Typography.Text>
        ),
    },
    {
      title: "Status",
      key: "status",
      width: 120,
      render: (_, row) => <Tag color={row.ready ? "success" : "warning"}>{row.ready ? "Ready" : "Not ready"}</Tag>,
      filters: [
        { text: "Ready", value: true },
        { text: "Not ready", value: false },
      ],
      onFilter: (value, row) => row.ready === value,
    },
    {
      title: "Actions",
      key: "actions",
      width: 210,
      render: (_, row) => (
        <Space>
          <Button
            type="link"
            disabled={!row.ready}
            onClick={() => openPage(row.name, "search")}
          >
            Search
          </Button>
          <Button
            type="text"
            icon={<ArrowRight size={15} />}
            disabled={!row.ready}
            onClick={() => openPage(row.name, "ingest")}
          >
            Ingest
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <section>
      <PageHeader
        title="Collections"
        description={`Vector readiness is checked against the configured ${collections.data?.model_dimension ?? 384}-dimension model.`}
        actions={
          <Button icon={<RefreshCw size={16} />} loading={collections.isFetching} onClick={() => collections.refetch()}>
            Refresh
          </Button>
        }
      />
      {collections.isError ? (
        <Alert type="error" showIcon message="Unable to load collections" description={errorMessage(collections.error)} />
      ) : null}
      <div className="surface table-surface">
        <Table
          rowKey="name"
          columns={columns}
          dataSource={collections.data?.collections ?? []}
          loading={collections.isLoading}
          pagination={false}
          locale={{ emptyText: <Empty description="No SolrCloud collections found" /> }}
          scroll={{ x: 900 }}
        />
      </div>
    </section>
  );
};
