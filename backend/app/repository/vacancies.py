from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.repository.sql import AS_OF, CLASSIFICATION_SELECT, CTE, FINAL_RUN, FOCUS_SELECT, SHOWN

Row = dict[str, Any]
# Only shown vacancies are ever listed; `level` narrows them to decided (`confirmed`) or on
# review (`likely`). `vpk` and `all` both keep the two (`vpk` is the historical default name).
LevelFilter = Literal["vpk", "confirmed", "likely", "all"]
# Vacancies of ВПК enterprises, of recruitment agencies hiring for the ВПК, or both.
Scope = Literal["vpk", "agency", "all"]
# Customer focus of the card's legal entity; `other` is a ВПК company with no focus tag.
Focus = Literal["drone", "missile", "kab", "other"]
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
    scope: Scope = "vpk"
    # Only vacancies with explicit ВПК markers in the text (state secret, GOZ, military acceptance…).
    markers: bool = False
    # The card's legal entity: its focus tag, industry (direction_domain) and role.
    focus: Focus | None = None
    domain: str | None = None
    role: str | None = None

    def where(self) -> tuple[str, dict[str, Any]]:
        clauses: list[str] = [f"v.{SHOWN}"]
        params: dict[str, Any] = {}
        if self.scope != "all":
            clauses.append("v.final_category = :scope")
            params["scope"] = self.scope
        if self.level in ("confirmed", "likely"):
            clauses.append("v.final_level = :level")
            params["level"] = self.level
        if self.markers:
            clauses.append("v.has_markers")
        if self.employer_id is not None:
            clauses.append("v.card_id = :employer_id")
            params["employer_id"] = self.employer_id
        if self.focus == "other":
            clauses.append(
                f"v.company_id IN (SELECT company_id FROM ({CLASSIFICATION_SELECT}) c"
                " WHERE c.vpk_category = 'vpk')"
                f" AND v.company_id NOT IN (SELECT company_id FROM ({FOCUS_SELECT}) f)"
            )
        elif self.focus:
            clauses.append(
                f"v.company_id IN (SELECT company_id FROM ({FOCUS_SELECT}) f WHERE f.focus = :focus)"
            )
            params["focus"] = self.focus
        for column in ("domain", "role"):
            if value := getattr(self, column):
                clauses.append(
                    f"v.company_id IN (SELECT company_id FROM ({CLASSIFICATION_SELECT}) c"
                    f" WHERE c.direction_{column} = :{column})"
                )
                params[column] = value
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
        return " AND ".join(clauses), params


LIST_COLUMNS = """
    v.vacancy_id AS id, v.source, v.url, v.card_id AS employer_id, v.employer_name, v.title,
    v.locality, v.region_id, r.name AS region, v.salary_from, v.salary_to, v.salary_currency, v.salary_period,
    v.monthly_salary, v.experience, v.schedule, v.employment, v.published_at, v.level, v.category,
    v.final_category, v.final_basis, v.has_markers
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
    """Any active vacancy by id, with its final label; `shown` says whether the site counts it."""
    row = (
        (
            await session.execute(
                text(f"""
                    WITH {CTE}
                    SELECT {LIST_COLUMNS}, v.final_level, v.final_score, v.{SHOWN} AS shown,
                           vac.address, vac.description, vac.responsibilities,
                           vac.requirements, vac.conditions, vac.skills_raw, vac.education,
                           cr.run_id, cr.classifier AS classifier_name, cr.version AS classifier_version
                    FROM v
                    JOIN vacancy vac USING (vacancy_id)
                    LEFT JOIN region r ON r.region_id = v.region_id
                    JOIN LATERAL (
                        SELECT run.run_id, run.classifier, run.version
                        FROM vacancy_classification c JOIN classifier_run run USING (run_id)
                        WHERE c.vacancy_id = v.vacancy_id
                        ORDER BY run.classifier = '{FINAL_RUN}' DESC, c.run_id DESC LIMIT 1
                    ) cr ON TRUE
                    WHERE v.vacancy_id = :id
                """),
                {"id": vacancy_id},
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        return None
    vacancy = dict(row)
    # Why the vacancy is here: the company decision, the JEV answer, explicit text markers.
    evidence = await session.execute(
        text("""
            SELECT signal, origin, weight, snippet FROM classification_evidence
            WHERE run_id = :run_id AND vacancy_id = :id
            ORDER BY weight DESC NULLS LAST, signal
        """),
        {"run_id": vacancy.pop("run_id"), "id": vacancy_id},
    )
    vacancy["evidence"] = [dict(r) for r in evidence.mappings()]
    return vacancy


async def list_professions(session: AsyncSession, f: VacancyFilter, limit: int) -> list[Row]:
    where, params = f.where()
    rows = await session.execute(
        text(f"""
            WITH {CTE}
            SELECT title, count(*) AS vacancies, count(DISTINCT card_id) AS employers,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY monthly_salary) AS median_salary,
                   mode() WITHIN GROUP (ORDER BY category) AS category
            FROM v WHERE {where}
            GROUP BY title ORDER BY count(*) DESC, title
            LIMIT :limit
        """),
        {**params, "limit": limit},
    )
    return [dict(r) for r in rows.mappings()]
