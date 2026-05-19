from typing import Any, Literal

from pydantic import BaseModel, Field


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


class RestProxyRequest(BaseModel):
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
    path: str = Field(min_length=1)
    query: dict[str, Any] = Field(default_factory=dict)
    body: Any | None = None
