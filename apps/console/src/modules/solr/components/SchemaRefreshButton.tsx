import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Tooltip } from "antd";
import { RefreshCw } from "lucide-react";

import { api, errorMessage } from "../services/api";

interface SchemaRefreshButtonProps {
  collection?: string;
  onRefreshed?: () => void;
}

export const SchemaRefreshButton = ({
  collection,
  onRefreshed,
}: SchemaRefreshButtonProps) => {
  const cache = useQueryClient();
  const refresh = useMutation({
    mutationFn: () => api.refreshSchema(collection ?? ""),
    onSuccess: (schema) => {
      cache.setQueryData(["solr", "schema", collection], schema);
      void cache.invalidateQueries({ queryKey: ["solr", "collections"] });
      onRefreshed?.();
    },
  });
  const title = refresh.isError
    ? `Schema refresh failed: ${errorMessage(refresh.error)}`
    : "Refresh schema from Solr";

  return (
    <Tooltip title={title}>
      <Button
        type="text"
        size="small"
        danger={refresh.isError}
        icon={<RefreshCw size={14} />}
        loading={refresh.isPending}
        disabled={!collection}
        aria-label={`Refresh ${collection ?? "collection"} schema`}
        onClick={() => refresh.mutate()}
      />
    </Tooltip>
  );
};
