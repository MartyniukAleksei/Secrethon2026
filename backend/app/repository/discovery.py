"""What was searched in open sources about each company (`discovery_log`)."""

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.search import sql_fold, variants

Row = dict[str, Any]

NAME = "coalesce(c.name_short_uk, c.name_full_uk, c.name_short_ru, c.name_full_ru)"


async def summary(session: AsyncSession) -> list[Row]:
    result = await session.execute(
        text("""
            SELECT provider, status, count(*) AS rows, min(found_at) AS first_at,
                   max(found_at) AS last_at
            FROM discovery_log GROUP BY provider, status ORDER BY provider, status
        """)
    )
    return [dict(r) for r in result.mappings()]


async def entries(
    session: AsyncSession,
    *,
    company_id: int | None,
    provider: str | None,
    status: str | None,
    q: str | None,
    limit: int,
    offset: int,
) -> tuple[int, list[Row]]:
    clauses, params = ["TRUE"], {}
    if company_id is not None:
        clauses.append("d.company_id = :company_id")
        params["company_id"] = company_id
    if provider:
        clauses.append("d.provider = :provider")
        params["provider"] = provider
    if status:
        clauses.append("d.status = :status")
        params["status"] = status
    if q:
        names = ("c.name_full_uk", "c.name_short_uk", "c.name_full_ru", "c.name_short_ru")
        clauses.append("(" + " OR ".join(f"{sql_fold(n)} ILIKE ANY(:q)" for n in names) + ")")
        params["q"] = [f"%{v}%" for v in variants(q)]
    where = " AND ".join(clauses)
    base = f"FROM discovery_log d LEFT JOIN company c ON c.company_id = d.company_id WHERE {where}"
    total = (await session.execute(text(f"SELECT count(*) {base}"), params)).scalar_one()
    rows = await session.execute(
        text(f"""
            SELECT d.log_id, d.company_id, {NAME} AS company_name,
                   (SELECT g.group_id FROM employer_group g
                    WHERE g.company_id = d.company_id AND g.is_head
                    ORDER BY g.is_branch, g.group_id LIMIT 1) AS card_id,
                   d.provider, d.query, d.url, d.title, d.snippet, d.published, d.found_at, d.status
            {base}
            ORDER BY d.found_at DESC NULLS LAST, d.log_id DESC
            LIMIT :limit OFFSET :offset
        """),
        {**params, "limit": limit, "offset": offset},
    )
    return total, [dict(r) for r in rows.mappings()]
