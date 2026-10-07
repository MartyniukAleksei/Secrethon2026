from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # hide_input_in_errors: never print DATABASE_URL (it contains the password) in errors.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)

    # Railway injects DATABASE_URL; locally it comes from backend/.env (see .env.example).
    database_url: str = "postgresql://postgres:postgres@localhost:5432/secrethon"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash-lite"
    tavily_api_key: str = ""
    agent_enabled: bool = True

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
