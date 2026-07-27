from functools import lru_cache

from pydantic import AnyHttpUrl, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    solr_url: AnyHttpUrl = Field(default="http://localhost:8983/solr")
    solr_username: str | None = None
    solr_password: str | None = None
    solr_verify_ssl: bool = True
    solr_connect_timeout_seconds: float = Field(default=5, ge=0.1, le=60)
    solr_read_timeout_seconds: float = Field(default=30, ge=1, le=300)
    solr_metadata_cache_ttl_seconds: float = Field(default=30, ge=0, le=300)
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dimension: int = 384
    query_embedding_cache_size: int = Field(default=512, ge=0, le=10_000)
    query_embedding_cache_ttl_seconds: float = Field(default=900, ge=0, le=86_400)
    max_upload_mb: int = Field(default=100, ge=1, le=2048)
    ingest_batch_size: int = Field(default=64, ge=1, le=256)
    upload_ttl_hours: int = Field(default=24, ge=1, le=168)
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
