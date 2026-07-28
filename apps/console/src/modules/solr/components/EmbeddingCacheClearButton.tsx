import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Popconfirm, Tooltip } from "antd";
import { Eraser } from "lucide-react";

import { api, errorMessage } from "../services/api";

interface EmbeddingCacheClearButtonProps {
  entries?: number;
  showLabel?: boolean;
  onCleared?: () => void;
}

export const EmbeddingCacheClearButton = ({
  entries,
  showLabel = false,
  onCleared,
}: EmbeddingCacheClearButtonProps) => {
  const cache = useQueryClient();
  const clearCache = useMutation({
    mutationFn: api.clearEmbeddingCache,
    onSuccess: (result) => {
      cache.setQueryData(["solr", "model"], result.model);
      void cache.invalidateQueries({ queryKey: ["solr", "health"] });
      void cache.invalidateQueries({ queryKey: ["solr", "embedding-preview"] });
      onCleared?.();
    },
  });
  const disabled = entries !== undefined && entries < 1;
  const countLabel = entries === undefined
    ? "cached query embeddings"
    : `${entries.toLocaleString()} cached ${entries === 1 ? "embedding" : "embeddings"}`;
  const tooltip = clearCache.isError
    ? `Cache clear failed: ${errorMessage(clearCache.error)}`
    : disabled
      ? "The query embedding cache is empty"
      : "Clear query embedding cache";

  return (
    <Popconfirm
      title={`Clear ${countLabel}?`}
      description="The embedding model stays loaded."
      disabled={disabled}
      onConfirm={() => clearCache.mutate()}
    >
      <Tooltip title={tooltip}>
        <Button
          type={showLabel ? "default" : "text"}
          size="small"
          danger={clearCache.isError}
          icon={<Eraser size={14} />}
          loading={clearCache.isPending}
          disabled={disabled}
          aria-label="Clear query embedding cache"
        >
          {showLabel ? "Clear cache" : null}
        </Button>
      </Tooltip>
    </Popconfirm>
  );
};
