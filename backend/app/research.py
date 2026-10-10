"""User-approved agent information in its own column, separate from pipeline facts."""

import json

from sqlalchemy import text

from app.reviews import _insert

DDL = """
    CREATE TABLE IF NOT EXISTS web_reviews.agent_research (
        id uuid PRIMARY KEY,
        employer_id bigint REFERENCES public.employer_profile(employer_profile_id),
        title text NOT NULL,
        question text NOT NULL,
        context jsonb NOT NULL,
        approved_info jsonb NOT NULL,
        parent_id uuid,
        approved_at timestamptz NOT NULL DEFAULT now()
    )
"""


def record(row) -> dict:
    value = dict(row)
    for key in ("context", "approved_info"):
        if isinstance(value[key], str):
            value[key] = json.loads(value[key])
    value["response"] = value.pop("approved_info")
    value["schema_version"] = 1
    return value


async def save_research(values: dict) -> dict:
    row = await _insert(
        """
            INSERT INTO web_reviews.agent_research
                (id, employer_id, title, question, context, approved_info, parent_id)
            VALUES (:id, :employer_id, :title, :question, CAST(:context AS jsonb),
                    CAST(:approved_info AS jsonb), :parent_id)
            ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
            RETURNING *
        """,
        {
            **values,
            "context": json.dumps(values["context"], ensure_ascii=False),
            "approved_info": json.dumps(values["approved_info"], ensure_ascii=False),
        },
        extra_ddl=[
            DDL,
            "CREATE INDEX IF NOT EXISTS agent_research_employer "
            "ON web_reviews.agent_research (employer_id, approved_at DESC)",
        ],
    )
    return record(row)


async def list_research(session, employer_id: int | None = None, limit: int = 30) -> list[dict]:
    # Reads never create tables or modify production data.
    if await session.scalar(text("SELECT to_regclass('web_reviews.agent_research')")) is None:
        return []
    rows = await session.execute(
        text("""
            SELECT * FROM web_reviews.agent_research
            WHERE (CAST(:employer_id AS bigint) IS NULL OR employer_id = :employer_id)
            ORDER BY approved_at DESC LIMIT :limit
        """),
        {"employer_id": employer_id, "limit": limit},
    )
    return [record(row) for row in rows.mappings()]
