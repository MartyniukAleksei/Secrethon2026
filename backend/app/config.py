from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # hide_input_in_errors: never print DATABASE_URL (it contains the password) in errors.
    model_config = SettingsConfigDict(
        # Shared local credentials live at the repo root; backend values take precedence.
        env_file=(
            Path(__file__).resolve().parents[2] / ".env",
            Path(__file__).resolve().parents[1] / ".env",
        ),
        extra="ignore",
        hide_input_in_errors=True,
    )

    # Railway injects DATABASE_URL; locally backend/.env overrides the repo-root .env.
    database_url: str = "postgresql://postgres:postgres@localhost:5432/secrethon"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash-lite"
    tavily_api_key: str = ""
    jev_api_key: str = ""
    jev_model: str = "jev-latest"
    gpt_base_url: str = ""
    gpt_api_key: str = Field(
        default="", validation_alias=AliasChoices("GPT_API_KEY", "TEAM_API_KEY", "TEAM_KEY_GPT")
    )
    gpt_model: str = "gpt-6-luna"
    agent_enabled: bool = True
    rag_enabled: bool = True
    rag_provider: Literal["local", "openai"] = "openai"
    rag_embedding_model: str = "text-embedding-3-large"
    rag_dimensions: int = Field(default=1024, ge=1, le=2000)
    embedding_base_url: str = "https://api.openai.com/v1"
    embedding_api_key: str = ""
    rag_cache_dir: str = str(Path(__file__).resolve().parents[1] / ".cache/rag")
    rag_local_model_file: str = "onnx/model_qint8_avx512_vnni.onnx"
    rag_threads: int = Field(default=2, ge=1, le=8)
    rag_top_k: int = Field(default=4, ge=1, le=8)
    rag_min_similarity: float | None = Field(default=None, ge=0, le=1)
    rag_context_bytes: int = Field(default=3600, ge=1000, le=8000)
    mcp_enabled: bool = True
    mcp_api_key: str = ""
    mcp_public_url: str = ""
    mcp_allowed_hosts: str = "127.0.0.1,localhost,[::1]"

    # Optional HTTP Basic Auth for the whole site; disabled when site_password is empty.
    site_user: str = "admin"
    site_password: str = ""

    # Development only: also show draft company profiles (production shows only 'published').
    profiles_include_drafts: bool = False

    @field_validator("database_url")
    @classmethod
    def use_asyncpg_driver(cls, url: str) -> str:
        # Tolerate values pasted with surrounding whitespace or quotes.
        url = url.strip().strip("\"'")
        # Railway/Heroku-style URLs have no driver; SQLAlchemy needs postgresql+asyncpg.
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                return "postgresql+asyncpg://" + url.removeprefix(prefix)
        if url.startswith("postgresql+asyncpg://"):
            return url
        scheme = url.split("://", 1)[0] if "://" in url else "<none>"
        raise ValueError(
            "DATABASE_URL must look like postgresql://user:password@host:port/db "
            f"(got {'an empty value' if not url else f'scheme {scheme!r}'}). "
            "On Railway set it to ${{Postgres.DATABASE_URL}}."
        )


settings = Settings()
