from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class VectorTarget(BaseModel):
    field: str = Field(min_length=1)
    provider: Literal["local", "field_native", "inference"] = "local"
    inference_id: str | None = None
    weight: float = Field(default=1.0, ge=0, le=10)
    min_similarity: float | None = Field(default=None, ge=-1, le=1)
    num_candidates: int | None = Field(default=None, ge=1, le=10_000)

    @field_validator("field")
    @classmethod
    def strip_field(cls, value: str) -> str:
        return value.strip()

    @field_validator("inference_id")
    @classmethod
    def strip_inference_id(cls, value: str | None) -> str | None:
        value = value.strip() if value else None
        return value or None

    @model_validator(mode="after")
    def validate_provider(self):
        if self.provider == "inference" and not self.inference_id:
            raise ValueError("An inference endpoint is required for the inference provider.")
        if self.provider != "inference" and self.inference_id:
            raise ValueError("inference_id is only valid with the inference provider.")
        return self


class LexicalField(BaseModel):
    field: str = Field(min_length=1)
    boost: float = Field(default=1.0, ge=0, le=20)

    @field_validator("field")
    @classmethod
    def strip_field(cls, value: str) -> str:
        return value.strip()


class SearchRequest(BaseModel):
    index: str = Field(min_length=1)
    text: str = Field(min_length=1, max_length=5000)
    mode: Literal["vector", "hybrid"] = "vector"
    result_mode: Literal["single", "compare", "fuse"] = "single"
    fusion_backend: Literal["application", "elasticsearch"] = "application"
    vector_targets: list[VectorTarget] = Field(min_length=1, max_length=8)
    lexical_fields: list[LexicalField] = Field(default_factory=list, max_length=32)
    lexical_weight: float = Field(default=1.0, ge=0, le=10)
    top_k: int = Field(default=10, ge=1, le=100)
    num_candidates: int = Field(default=100, ge=1, le=10_000)
    rank_constant: int = Field(default=60, ge=1, le=1000)
    rank_window_size: int = Field(default=100, ge=1, le=1000)
    filters: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    source_fields: list[str] = Field(default_factory=list, max_length=100)
    timeout_ms: int = Field(default=15_000, ge=1000, le=120_000)

    @field_validator("index", "text")
    @classmethod
    def strip_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Value cannot be empty.")
        return value

    @field_validator("index")
    @classmethod
    def relative_index_name(cls, value: str) -> str:
        if "://" in value or value.startswith("/") or any(token in value for token in ("?", "#")):
            raise ValueError("index must be an Elasticsearch index or alias name.")
        return value

    @field_validator("source_fields")
    @classmethod
    def unique_source_fields(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(value.strip() for value in values if value.strip()))

    @model_validator(mode="after")
    def validate_mode(self):
        fields = [target.field for target in self.vector_targets]
        if len(fields) != len(set(fields)):
            raise ValueError("Each vector field may be selected only once.")
        if self.result_mode == "single" and len(self.vector_targets) != 1:
            raise ValueError("Single mode requires exactly one vector target.")
        if self.result_mode in {"compare", "fuse"} and len(self.vector_targets) < 2:
            raise ValueError(f"{self.result_mode.title()} mode requires at least two vector targets.")
        if self.mode == "hybrid" and not self.lexical_fields:
            raise ValueError("Hybrid search requires at least one lexical field.")
        if self.rank_window_size < self.top_k:
            raise ValueError("rank_window_size must be greater than or equal to top_k.")
        if self.result_mode != "fuse" and self.fusion_backend == "elasticsearch":
            raise ValueError("Elasticsearch fusion is only available in fuse mode.")
        if self.result_mode == "fuse" and not any(target.weight > 0 for target in self.vector_targets):
            if self.mode != "hybrid" or self.lexical_weight <= 0:
                raise ValueError("At least one fusion source must have a positive weight.")
        return self


class EmbeddingPreviewRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)

    @field_validator("text")
    @classmethod
    def strip_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Query text cannot be empty.")
        return value
