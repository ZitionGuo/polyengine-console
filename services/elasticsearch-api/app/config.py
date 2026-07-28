from functools import lru_cache

from pydantic import AnyHttpUrl, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    elasticsearch_url: AnyHttpUrl = Field(default="http://localhost:9200")
    elasticsearch_api_key: str | None = None
    elasticsearch_username: str | None = None
    elasticsearch_password: str | None = None
    elasticsearch_verify_ssl: bool = True
    elasticsearch_ca_cert: str | None = None
    elasticsearch_connect_timeout_seconds: float = Field(default=5, ge=0.1, le=60)
    elasticsearch_read_timeout_seconds: float = Field(default=30, ge=1, le=300)
    elasticsearch_metadata_cache_ttl_seconds: float = Field(default=30, ge=0, le=300)
    embedding_model: str = "Qwen/Qwen3-Embedding-0.6B"
    embedding_dimension: int = Field(default=384, ge=32, le=4096)
    embedding_query_instruction: str = (
        "Given a web search query, retrieve relevant passages that answer the query"
    )
    query_embedding_cache_size: int = Field(default=512, ge=0, le=10_000)
    query_embedding_cache_ttl_seconds: float = Field(default=900, ge=0, le=86_400)
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
