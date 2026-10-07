from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings


# Pipeline sessions are read-only on the server side, so even a buggy query cannot write.
# app.reviews uses a separate connection to append reviews in the web_reviews schema.
def make_engine(url: str, **kwargs: Any) -> AsyncEngine:
    return create_async_engine(
        url,
        pool_pre_ping=True,
        connect_args={
            "server_settings": {
                "default_transaction_read_only": "on",
                "statement_timeout": "20000",
                "application_name": "secrethon-web",
            }
        },
        **kwargs,
    )


engine = make_engine(settings.database_url)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
