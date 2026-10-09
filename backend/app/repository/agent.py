"""Bounded, parameterized analytics; the model never writes SQL."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.repository.sql import AS_OF, CTE, GUR_BY_INN
from app.repository.vacancies import VacancyFilter

GROUPS = {
    "summary": ("(1::integer)", "'Уся вибірка'::text"),
    "company": ("v.card_id", "coalesce(ep.name, v.employer_name, 'Невідомо')"),
    "region": ("v.region_id", "coalesce(r.name, 'Регіон не вказано')"),
    "category": ("v.category", "coalesce(v.category, 'Напрям не вказано')"),
    "month": (
        "date_trunc('month', v.published_at)::date",
        "date_trunc('month', v.published_at)::date::text",
    ),
}


async def analytics(
    session: AsyncSession,
    filters: VacancyFilter,
    group_by: str,
    metric: str,
    query: str = "",
    employer_ids: list[int] | None = None,
    limit: int = 10,
    only_sanctioned: bool = False,
) -> dict:
    where, params = filters.where()
    if query:
        where += " AND (ep.name ILIKE :name OR ep.inn = :exact)"
        params.update(name=f"%{query}%", exact=query)
    if employer_ids:
        where += " AND v.card_id = ANY(:ids)"
        params["ids"] = employer_ids
    if only_sanctioned:
        where += " AND coalesce(g.sanctions_count, 0) > 0"
    ident, label = GROUPS[group_by]
    value = (
        "count(*)"
        if metric == "vacancies"
        else "percentile_cont(0.5) WITHIN GROUP (ORDER BY v.monthly_salary)"
    )
    order = "id ASC NULLS LAST" if group_by == "month" else "value DESC NULLS LAST, label"
    rows = await session.execute(
        text(f"""
            WITH {CTE}, {GUR_BY_INN}
            SELECT {ident} AS id, {label} AS label, {value} AS value,
                   count(*) AS vacancies, count(v.monthly_salary) AS salary_samples,
                   count(*) FILTER (WHERE v.level = 'confirmed') AS confirmed_vacancies,
                   max(coalesce(g.sanctions_count, 0)) AS sanctions_count
            FROM v
            LEFT JOIN employer_profile ep ON ep.employer_profile_id = v.card_id
            LEFT JOIN region r ON r.region_id = v.region_id
            LEFT JOIN gur g ON g.inn = ep.inn
            WHERE {where}
            GROUP BY {ident}, {label}
            ORDER BY {order} LIMIT :limit
        """),
        {**params, "limit": limit},
    )
    as_of = (await session.execute(text(f"SELECT {AS_OF}"))).scalar_one()
    return {"rows": [dict(row) for row in rows.mappings()], "as_of": as_of}
