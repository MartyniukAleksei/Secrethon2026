"""Append-only reviews, isolated from the read-only pipeline tables."""

import asyncio
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.config import settings

engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,
    connect_args={
        "server_settings": {"statement_timeout": "20000", "application_name": "stayhard-reviews"}
    },
)
_schema_lock = asyncio.Lock()

DDL = [
    "CREATE SCHEMA IF NOT EXISTS web_reviews",
    """
        CREATE TABLE IF NOT EXISTS web_reviews.vacancy_review (
            review_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            vacancy_id bigint NOT NULL REFERENCES public.vacancy(vacancy_id) ON DELETE CASCADE,
            source text NOT NULL CHECK (source IN ('human', 'llm')),
            confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
            reviewed_by text NOT NULL CHECK (length(btrim(reviewed_by)) BETWEEN 2 AND 120),
            comment text CHECK (length(comment) <= 2000),
            reviewed_at timestamptz NOT NULL DEFAULT now()
        )
    """,
    """
        CREATE INDEX IF NOT EXISTS vacancy_review_latest
        ON web_reviews.vacancy_review (vacancy_id, source, review_id DESC)
    """,
]


async def list_reviews(session: AsyncSession, vacancy_id: int) -> list[dict[str, Any]]:
    """Read existing reviews; opening a vacancy never creates or modifies tables."""
    exists = await session.scalar(text("SELECT to_regclass('web_reviews.vacancy_review')"))
    if exists is None:
        return []
    result = await session.execute(
        text("""
            SELECT review_id, vacancy_id, source, confidence, reviewed_by, comment, reviewed_at
            FROM web_reviews.vacancy_review WHERE vacancy_id = :id
            ORDER BY review_id DESC
        """),
        {"id": vacancy_id},
    )
    return [dict(row) for row in result.mappings()]


async def save_review(vacancy_id: int, values: dict[str, Any]) -> dict[str, Any]:
    # Schema creation is transactional and serialized within the service. It runs only
    # when someone explicitly saves a review, using a separate write connection.
    async with _schema_lock:
        async with engine.begin() as conn:
            # The advisory lock also serializes first saves across workers/replicas.
            await conn.execute(text("SELECT pg_advisory_xact_lock(20261006, 1)"))
            for statement in DDL:
                await conn.execute(text(statement))
            result = await conn.execute(
                text("""
                    INSERT INTO web_reviews.vacancy_review
                        (vacancy_id, source, confidence, reviewed_by, comment)
                    VALUES (:id, :source, :confidence, :reviewed_by, :comment)
                    RETURNING review_id, vacancy_id, source, confidence, reviewed_by,
                              comment, reviewed_at
                """),
                {"id": vacancy_id, **values},
            )
            return dict(result.mappings().one())
