from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class SearchBaseRequest(BaseModel):
    collection: str = Field(min_length=1)
    mode: Literal["semantic", "hybrid"] = "semantic"
    hybrid_strategy: Literal["rerank", "rrf"] = "rerank"
    text: str = Field(min_length=1, max_length=5000)
    lexical_fields: list[str] = Field(default_factory=list)
    lexical_boosts: dict[str, float] = Field(default_factory=dict)
    limit: int = Field(default=10, ge=1, le=100)
    vector_candidates: int = Field(default=100, ge=1, le=10_000)
    lexical_candidates: int = Field(default=100, ge=1, le=10_000)
    rerank_docs: int = Field(default=100, ge=1, le=10_000)
    rerank_weight: float = Field(default=2.0, ge=0, le=10)
    lexical_weight: float = Field(default=1.0, ge=0, le=10)
    vector_weight: float = Field(default=1.0, ge=0, le=10)
    hybrid_rrf_k: int = Field(default=60, ge=1, le=1000)
    timeout_ms: int = Field(default=15_000, ge=1_000, le=120_000)
    min_score: float | None = Field(default=None, ge=-1, le=1)
    filters: list[str] = Field(default_factory=list, max_length=20)
    return_fields: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("collection")
    @classmethod
    def strip_name(cls, value: str) -> str:
        return value.strip()

    @field_validator("text")
    @classmethod
    def strip_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Query text cannot be empty.")
        return value

    @field_validator("lexical_fields", "return_fields")
    @classmethod
    def unique_names(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(value.strip() for value in values if value.strip()))

    @field_validator("filters")
    @classmethod
    def clean_filters(cls, values: list[str]) -> list[str]:
        return [value.strip() for value in values if value.strip()]

    @model_validator(mode="after")
    def require_hybrid_fields(self):
        if self.mode == "hybrid" and not self.lexical_fields:
            raise ValueError("Hybrid search requires at least one lexical field.")
        unknown = sorted(set(self.lexical_boosts) - set(self.lexical_fields))
        if unknown:
            raise ValueError(f"Boosts reference unselected lexical fields: {', '.join(unknown)}.")
        if any(boost < 0 or boost > 20 for boost in self.lexical_boosts.values()):
            raise ValueError("Lexical boosts must be between 0 and 20.")
        if self.mode == "hybrid" and not any(
            self.lexical_boosts.get(field, 1.0) > 0 for field in self.lexical_fields
        ):
            raise ValueError("At least one lexical field must have a positive boost.")
        if (
            self.mode == "hybrid"
            and self.hybrid_strategy == "rrf"
            and self.lexical_weight <= 0
            and self.vector_weight <= 0
        ):
            raise ValueError("Hybrid RRF requires a positive lexical or vector weight.")
        return self


class SearchRequest(SearchBaseRequest):
    vector_field: str = Field(min_length=1)

    @field_validator("vector_field")
    @classmethod
    def strip_vector_field(cls, value: str) -> str:
        return value.strip()


class SearchCompareRequest(SearchBaseRequest):
    vector_fields: list[str] = Field(min_length=2, max_length=16)
    vector_min_scores: dict[str, float] = Field(default_factory=dict)

    @field_validator("vector_fields")
    @classmethod
    def clean_vector_fields(cls, values: list[str]) -> list[str]:
        cleaned = list(dict.fromkeys(value.strip() for value in values if value.strip()))
        if len(cleaned) < 2:
            raise ValueError("Select at least two distinct vector fields.")
        return cleaned

    @model_validator(mode="after")
    def validate_vector_min_scores(self):
        unknown = sorted(set(self.vector_min_scores) - set(self.vector_fields))
        if unknown:
            raise ValueError(
                f"Minimum scores reference unselected vector fields: {', '.join(unknown)}."
            )
        if any(score < -1 or score > 1 for score in self.vector_min_scores.values()):
            raise ValueError("Vector minimum scores must be between -1 and 1.")
        return self


class SearchFuseRequest(SearchCompareRequest):
    vector_weights: dict[str, float] = Field(default_factory=dict)
    fusion_candidates: int = Field(default=50, ge=2, le=500)
    rrf_k: int = Field(default=60, ge=1, le=1000)

    @model_validator(mode="after")
    def validate_vector_weights(self):
        unknown = sorted(set(self.vector_weights) - set(self.vector_fields))
        if unknown:
            raise ValueError(f"Weights reference unselected vector fields: {', '.join(unknown)}.")
        if any(weight < 0 or weight > 10 for weight in self.vector_weights.values()):
            raise ValueError("Vector weights must be between 0 and 10.")
        has_vector_source = any(
            self.vector_weights.get(field, 1.0) > 0 for field in self.vector_fields
        )
        has_lexical_source = (
            self.mode == "hybrid"
            and self.hybrid_strategy == "rrf"
            and self.lexical_weight > 0
        )
        if not has_vector_source and not has_lexical_source:
            raise ValueError("At least one fusion source must have a positive weight.")
        return self


class IngestVectorTarget(BaseModel):
    vector_field: str = Field(min_length=1)
    text_fields: list[str] = Field(min_length=1, max_length=32)

    @field_validator("vector_field")
    @classmethod
    def strip_vector_field(cls, value: str) -> str:
        return value.strip()

    @field_validator("text_fields")
    @classmethod
    def clean_text_fields(cls, values: list[str]) -> list[str]:
        cleaned = list(dict.fromkeys(value.strip() for value in values if value.strip()))
        if not cleaned:
            raise ValueError("At least one text field is required.")
        return cleaned


class IngestJobCreateRequest(BaseModel):
    upload_id: str = Field(min_length=1)
    collection: str = Field(min_length=1)
    id_field: str = Field(min_length=1)
    vector_targets: list[IngestVectorTarget] = Field(default_factory=list, max_length=16)
    text_fields: list[str] | None = Field(default=None, min_length=1, max_length=32)
    vector_field: str | None = Field(default=None, min_length=1)
    batch_size: int = Field(default=64, ge=1, le=256)
    commit_within_ms: int = Field(default=1000, ge=0, le=60_000)

    @field_validator("upload_id", "collection", "id_field")
    @classmethod
    def strip_value(cls, value: str) -> str:
        return value.strip()

    @field_validator("vector_field")
    @classmethod
    def strip_optional_vector_field(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @field_validator("text_fields")
    @classmethod
    def clean_legacy_text_fields(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        cleaned = list(dict.fromkeys(value.strip() for value in values if value.strip()))
        if not cleaned:
            raise ValueError("At least one text field is required.")
        return cleaned

    @model_validator(mode="after")
    def normalize_vector_targets(self):
        legacy_present = self.vector_field is not None or self.text_fields is not None
        if self.vector_targets and legacy_present:
            raise ValueError("Use vector_targets or the legacy vector_field/text_fields pair, not both.")
        if not self.vector_targets:
            if self.vector_field is None or self.text_fields is None:
                raise ValueError("At least one vector target is required.")
            self.vector_targets = [
                IngestVectorTarget(
                    vector_field=self.vector_field,
                    text_fields=self.text_fields,
                )
            ]
        duplicates = sorted(
            {
                target.vector_field
                for target in self.vector_targets
                if sum(
                    item.vector_field == target.vector_field
                    for item in self.vector_targets
                )
                > 1
            }
        )
        if duplicates:
            raise ValueError(f"Vector fields may be mapped only once: {', '.join(duplicates)}.")
        return self


class SolrErrorDetail(BaseModel):
    message: str
    upstream_status: int | None = None
    upstream_body: Any | None = None
