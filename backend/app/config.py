from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Railway injects DATABASE_URL; locally it comes from backend/.env (see .env.example).
    database_url: str = "postgresql://postgres:postgres@localhost:5432/secrethon"

    @field_validator("database_url")
    @classmethod
    def use_asyncpg_driver(cls, url: str) -> str:
        # Railway/Heroku-style URLs have no driver; SQLAlchemy needs postgresql+asyncpg.
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                return "postgresql+asyncpg://" + url.removeprefix(prefix)
        return url


settings = Settings()
