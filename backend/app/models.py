from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class AliasCreateRequest(BaseModel):
    alias_name: str = Field(min_length=1)
    collection_name: str = Field(min_length=1)


class AliasRenameRequest(BaseModel):
    new_alias_name: str = Field(min_length=1)


class IndexCreateRequest(BaseModel):
    field_name: str = Field(min_length=1)
    field_schema: Any


class CollectionCreateRequest(BaseModel):
    config: dict[str, Any]
    indexes: list[IndexCreateRequest] = Field(default_factory=list)


class CollectionUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    params: dict[str, Any] | None = None
    vectors: dict[str, Any] | None = None
    sparse_vectors: dict[str, Any] | None = None
    hnsw_config: dict[str, Any] | None = None
    optimizers_config: dict[str, Any] | None = None
    quantization_config: Any | None = None
    strict_mode_config: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None


class PointsScrollRequest(BaseModel):
    limit: int = Field(default=20, ge=1, le=100)
    offset: Any | None = None
    filter: dict[str, Any] | None = None
    with_payload: Any = True
    with_vector: Any = False


class PointsQueryRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    query: Any
    using: str | None = None
    filter: dict[str, Any] | None = None
    params: dict[str, Any] | None = None
    limit: int = Field(default=10, ge=1, le=100)
    offset: Any | None = None
    with_payload: Any = True
    with_vector: Any = False
    score_threshold: float | None = None


class PointsRetrieveRequest(BaseModel):
    ids: list[Any] = Field(min_length=1)
    with_payload: Any = True
    with_vector: Any = False


class PointsDeleteRequest(BaseModel):
    points: list[Any] = Field(min_length=1)


class PointsUpsertRequest(BaseModel):
    points: list[dict[str, Any]] = Field(min_length=1)


class PointsPayloadOverwriteRequest(BaseModel):
    payload: dict[str, Any]
    points: list[Any] = Field(min_length=1)


class PointsPayloadClearRequest(BaseModel):
    points: list[Any] = Field(min_length=1)


class RestProxyRequest(BaseModel):
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
    path: str = Field(min_length=1)
    query: dict[str, Any] = Field(default_factory=dict)
    body: Any | None = None
