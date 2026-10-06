from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.repository.sql import AS_OF, CTE

VPK_V = "v.level IN ('confirmed', 'likely')"

Row = dict[str, Any]
LevelFilter = Literal["vpk", "confirmed", "likely", "all"]
Sort = Literal["published", "salary"]


@dataclass(frozen=True)
class VacancyFilter:
    level: LevelFilter = "vpk"
    employer_id: int | None = None
    region_id: int | None = None
    category: str | None = None
    title: str | None = None
    q: str | None = None
    days: int | None = None

    def where(self) -> tuple[str, dict[str, Any]]:
        clauses: list[str] = []
        params: dict[str, Any] = {}
        if self.level == "vpk":
            clauses.append(VPK_V)
        elif self.level != "all":
            clauses.append("v.level = :level")
            params["level"] = self.level
        if self.employer_id is not None:
            clauses.append("v.employer_profile_id = :employer_id")
            params["employer_id"] = self.employer_id
        if self.region_id is not None:
            clauses.append("v.region_id = :region_id")
            params["region_id"] = self.region_id
        if self.category:
            clauses.append("v.category = :category")
            params["category"] = self.category
        if self.title:
            clauses.append("v.title = :title")
            params["title"] = self.title
        if self.q:
            clauses.append("(v.title ILIKE :q OR v.employer_name ILIKE :q OR v.locality ILIKE :q)")
            params["q"] = f"%{self.q}%"
        if self.days:
            clauses.append(f"v.published_at > {AS_OF} - make_interval(days => :days)")
            params["days"] = self.days
        return (" AND ".join(clauses) or "TRUE"), params


LIST_COLUMNS = """
    v.vacancy_id AS id, v.source, v.url, v.employer_profile_id AS employer_id, v.employer_name, v.title,
    v.locality, v.region_id, r.name AS region, v.salary_from, v.salary_to, v.salary_currency, v.salary_period,
    v.monthly_salary, v.experience, v.schedule, v.employment, v.published_at, v.level, v.category
"""


async def list_vacancies(
    session: AsyncSession, f: VacancyFilter, sort: Sort, limit: int, offset: int
) -> tuple[int, list[Row]]:
    where, params = f.where()
    order = (
        "v.monthly_salary DESC NULLS LAST, v.vacancy_id"
        if sort == "salary"
        else "v.published_at DESC NULLS LAST, v.vacancy_id DESC"
    )
    total = (
        await session.execute(text(f"WITH {CTE} SELECT count(*) FROM v WHERE {where}"), params)
    ).scalar_one()
    rows = await session.execute(
        text(f"""
            WITH {CTE}
            SELECT {LIST_COLUMNS}
            FROM v LEFT JOIN region r ON r.region_id = v.region_id
            WHERE {where}
            ORDER BY {order}
            LIMIT :limit OFFSET :offset
        """),
        {**params, "limit": limit, "offset": offset},
    )
    return total, [dict(r) for r in rows.mappings()]


async def get_vacancy(session: AsyncSession, vacancy_id: int) -> Row | None:
    row = (
        (
            await session.execute(
                text(f"""
                    WITH {CTE}
                    SELECT {LIST_COLUMNS}, vac.address, vac.description, vac.responsibilities,
                           vac.requirements, vac.conditions, vac.skills_raw, vac.education
                    FROM v
                    JOIN vacancy vac USING (vacancy_id)
                    LEFT JOIN region r ON r.region_id = v.region_id
                    WHERE v.vacancy_id = :id
                """),
                {"id": vacancy_id},
            )
        )
        .mappings()
        .first()
    )
    return dict(row) if row else None


async def list_professions(session: AsyncSession, f: VacancyFilter, limit: int) -> list[Row]:
    where, params = f.where()
    rows = await session.execute(
        text(f"""
            WITH {CTE}
            SELECT title, count(*) AS vacancies, count(DISTINCT employer_profile_id) AS employers,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY monthly_salary) AS median_salary,
                   mode() WITHIN GROUP (ORDER BY category) AS category
            FROM v WHERE {where}
            GROUP BY title ORDER BY count(*) DESC, title
            LIMIT :limit
        """),
        {**params, "limit": limit},
    )
    return [dict(r) for r in rows.mappings()]
