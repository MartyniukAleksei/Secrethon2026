"""Append-only reviews, isolated from the read-only pipeline tables."""

import asyncio
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, create_async_engine

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
    # A human snapshot of the employer card. NULL in a field means "not reviewed, keep the
    # automatic value"; the latest row per employer is the one in effect.
    """
        CREATE TABLE IF NOT EXISTS web_reviews.employer_review (
            review_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            employer_id bigint NOT NULL
                REFERENCES public.employer_profile(employer_profile_id) ON DELETE CASCADE,
            sources text[] CHECK (
                cardinality(sources) > 0 AND sources <@ ARRAY[
                    'hh', 'trudvsem', 'superjob', 'gur',
                    'registry', 'company_site', 'media', 'other'
                ]
            ),
            reliability text CHECK (reliability IN ('A', 'B', 'C', 'D', 'E', 'F')),
            category text CHECK (category IN ('производство', 'НИИ/КБ', 'ремонт')),
            sanctions text CHECK (sanctions IN ('sanctioned', 'not_sanctioned')),
            vpk text CHECK (vpk IN ('confirmed', 'likely', 'no')),
            reviewed_by text NOT NULL CHECK (length(btrim(reviewed_by)) BETWEEN 2 AND 120),
            comment text CHECK (length(comment) <= 2000),
            reviewed_at timestamptz NOT NULL DEFAULT now(),
            CHECK (num_nonnulls(sources, reliability, category, sanctions, vpk) > 0)
        )
    """,
    """
        CREATE INDEX IF NOT EXISTS employer_review_latest
        ON web_reviews.employer_review (employer_id, review_id DESC)
    """,
]

EMPLOYER_REVIEW_COLUMNS = (
    "review_id, employer_id, sources, reliability, category, sanctions, vpk, "
    "reviewed_by, comment, reviewed_at"
)


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


async def _insert(statement: str, values: dict[str, Any]) -> dict[str, Any]:
    # Schema creation is transactional and serialized within the service. It runs only
    # when someone explicitly saves a review, using a separate write connection.
    async with _schema_lock:
        async with engine.begin() as conn:
            # The advisory lock also serializes first saves across workers/replicas.
            await conn.execute(text("SELECT pg_advisory_xact_lock(20261006, 1)"))
            for ddl in DDL:
                await conn.execute(text(ddl))
            result = await conn.execute(text(statement), values)
            return dict(result.mappings().one())


async def save_review(vacancy_id: int, values: dict[str, Any]) -> dict[str, Any]:
    return await _insert(
        """
            INSERT INTO web_reviews.vacancy_review
                (vacancy_id, source, confidence, reviewed_by, comment)
            VALUES (:id, :source, :confidence, :reviewed_by, :comment)
            RETURNING review_id, vacancy_id, source, confidence, reviewed_by, comment, reviewed_at
        """,
        {"id": vacancy_id, **values},
    )


async def employer_reviews_ready(conn: AsyncSession | AsyncConnection) -> bool:
    """Whether the employer review table exists; reads never create it."""
    exists = await conn.scalar(text("SELECT to_regclass('web_reviews.employer_review')"))
    return exists is not None


async def list_employer_reviews(
    session: AsyncSession, profile_ids: list[int]
) -> list[dict[str, Any]]:
    """Reviews of a card: saved under any of its profiles (older reviews predate the cards)."""
    if not await employer_reviews_ready(session):
        return []
    result = await session.execute(
        text(f"""
            SELECT {EMPLOYER_REVIEW_COLUMNS} FROM web_reviews.employer_review
            WHERE employer_id = ANY(:ids) ORDER BY review_id DESC
        """),
        {"ids": profile_ids},
    )
    return [dict(row) for row in result.mappings()]


async def save_employer_review(employer_id: int, values: dict[str, Any]) -> dict[str, Any]:
    return await _insert(
        f"""
            INSERT INTO web_reviews.employer_review
                (employer_id, sources, reliability, category, sanctions, vpk, reviewed_by, comment)
            VALUES (:id, :sources, :reliability, :category, :sanctions, :vpk,
                    :reviewed_by, :comment)
            RETURNING {EMPLOYER_REVIEW_COLUMNS}
        """,
        {"id": employer_id, **values},
    )
