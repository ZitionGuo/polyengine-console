from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator


NonEmptyName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class AliasCreateRequest(BaseModel):
    alias_name: NonEmptyName
    collection_name: NonEmptyName


class AliasUpdateRequest(BaseModel):
    new_alias_name: NonEmptyName | None = None
    collection_name: NonEmptyName | None = None

    @model_validator(mode="after")
    def require_change(self):
        if self.new_alias_name is None and self.collection_name is None:
            raise ValueError("At least one alias update field is required.")
        return self


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


class PointsCountRequest(BaseModel):
    filter: dict[str, Any] | None = None
    exact: bool = True
    shard_key: Any | None = None


class PointsFacetRequest(BaseModel):
    key: NonEmptyName
    limit: int = Field(default=10, ge=1, le=100)
    filter: dict[str, Any] | None = None
    exact: bool = False
    shard_key: Any | None = None


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
