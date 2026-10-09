from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.repository.sql import AS_OF, CLASSIFICATION_SELECT, CTE, FINAL_RUN, FOCUS_SELECT, SHOWN
from app.search import sql_fold, variants

Row = dict[str, Any]
# Only shown vacancies are ever listed; `level` narrows them to decided (`confirmed`) or on
# review (`likely`). `vpk` and `all` both keep the two (`vpk` is the historical default name).
LevelFilter = Literal["vpk", "confirmed", "likely", "all"]
# Vacancies of ВПК enterprises, of recruitment agencies hiring for the ВПК, or both.
Scope = Literal["vpk", "agency", "all"]
# Customer focus of the card's legal entity; `other` is a ВПК company with no focus tag.
Focus = Literal["drone", "missile", "kab", "other"]
# `confirmed` (default): decided vacancies first, then the newest.
Sort = Literal["confirmed", "published", "salary"]


# A null value of a faceted column (no category, experience, schedule or employment given).
NONE = "none"
Many = Sequence[str] | str | None


def many(value: Any) -> tuple[Any, ...]:
    """One value, several or none, as a tuple: filters take a scalar or a list."""
    if value is None or value == "":
        return ()
    if isinstance(value, (str, int)):
        return (value,)
    return tuple(value)


@dataclass(frozen=True)
class VacancyFilter:
    level: LevelFilter = "vpk"
    employer_id: int | None = None
    # Agent map scopes: server-resolved card ids; an empty sequence matches nothing.
    employer_ids: Sequence[int] | None = None
    # West, south, east, north; west > east denotes crossing the antimeridian.
    bounds: tuple[float, float, float, float] | None = None
    # Each of the faceted fields takes one value or several (any of them matches).
    region_id: int | Sequence[int] | None = None
    category: Many = None
    title: str | None = None
    q: str | None = None
    days: int | None = None
    scope: Scope = "vpk"
    # Only vacancies with explicit ВПК markers in the text (state secret, GOZ, military acceptance…).
    markers: bool = False
    # Focus is the legal entity's; domain and role describe the individual vacancy duties.
    focus: Focus | Sequence[Focus] | None = None
    domain: Many = None
    role: Many = None
    # Job site and the vacancy's own fields, as published (`none` = not given).
    source: Many = None
    experience: Many = None
    schedule: Many = None
    employment: Many = None
    # Monthly salary in RUB (see `monthly_salary`); `with_salary` drops vacancies without one.
    salary_min: int | None = None
    salary_max: int | None = None
    with_salary: bool = False
    # Only vacancies shown on the site; the export's wider coverages turn it off.
    shown_only: bool = True

    def parts(self) -> tuple[list[str], dict[str, str], dict[str, Any]]:
        """Plain clauses, the clause of each faceted field, and the query parameters."""
        clauses: list[str] = [f"v.{SHOWN}" if self.shown_only else "true"]
        facets: dict[str, str] = {}
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
        if self.employer_ids is not None:
            clauses.append("v.card_id = ANY(:scope_ids)")
            params["scope_ids"] = list(self.employer_ids)
        if self.bounds is not None:
            west, south, east, north = self.bounds
            clauses.append("v.lat BETWEEN -85 AND 85 AND v.lng BETWEEN -180 AND 180")
            clauses.append("v.lat BETWEEN :south AND :north")
            longitude = (
                "v.lng BETWEEN :west AND :east"
                if west <= east
                else "(v.lng >= :west OR v.lng <= :east)"
            )
            clauses.append(longitude)
            params.update(west=west, south=south, east=east, north=north)
        if focus := many(self.focus):
            tagged = [f for f in focus if f != "other"]
            options = []
            if "other" in focus:
                options.append(
                    f"(v.company_id IN (SELECT company_id FROM ({CLASSIFICATION_SELECT}) c"
                    " WHERE c.vpk_category = 'vpk')"
                    f" AND v.company_id NOT IN (SELECT company_id FROM ({FOCUS_SELECT}) f))"
                )
            if tagged:
                options.append(
                    f"v.company_id IN (SELECT company_id FROM ({FOCUS_SELECT}) f"
                    " WHERE f.focus = ANY(:focus))"
                )
                params["focus"] = tagged
            facets["focus"] = "(" + " OR ".join(options) + ")"
        for column in ("domain", "role"):
            if values := many(getattr(self, column)):
                facets[column] = f"v.direction_{column} = ANY(:{column})"
                params[column] = list(values)
        if regions := many(self.region_id):
            facets["region_id"] = "v.region_id = ANY(:region_id)"
            params["region_id"] = [int(r) for r in regions]
        if sources := many(self.source):
            facets["source"] = "v.source = ANY(:source)"
            params["source"] = list(sources)
        for column in ("category", "experience", "schedule", "employment"):
            if values := many(getattr(self, column)):
                known = [x for x in values if x != NONE]
                options = [f"v.{column} = ANY(:{column})"] if known else []
                if NONE in values:
                    options.append(f"v.{column} IS NULL")
                facets[column] = "(" + " OR ".join(options) + ")"
                if known:
                    params[column] = known
        if self.title:
            clauses.append("v.title = :title")
            params["title"] = self.title
        if self.q:
            # Ukrainian or Latin spelling finds the Russian names too (app/search.py).
            clauses.append(
                "("
                + " OR ".join(
                    f"{sql_fold(c)} ILIKE ANY(:q)"
                    for c in ("v.title", "v.employer_name", "v.locality")
                )
                + ")"
            )
            params["q"] = [f"%{x}%" for x in variants(self.q)]
        if self.days:
            clauses.append(f"v.published_at > {AS_OF} - make_interval(days => :days)")
            params["days"] = self.days
        if self.with_salary:
            clauses.append("v.monthly_salary IS NOT NULL")
        if self.salary_min is not None:
            clauses.append("v.monthly_salary >= :salary_min")
            params["salary_min"] = self.salary_min
        if self.salary_max is not None:
            clauses.append("v.monthly_salary <= :salary_max")
            params["salary_max"] = self.salary_max
        return clauses, facets, params

    def where(self) -> tuple[str, dict[str, Any]]:
        clauses, facets, params = self.parts()
        return " AND ".join([*clauses, *facets.values()]), params


# Faceted fields: the value each vacancy counts under (focus is joined apart: a company may
# have several tags).
FACET_COLUMNS = {
    "region_id": "b.region_id::text",
    "source": "b.source",
    "category": "b.category",
    "experience": "b.experience",
    "schedule": "b.schedule",
    "employment": "b.employment",
    "domain": "b.direction_domain",
    "role": "b.direction_role",
}


async def facets(session: AsyncSession, f: VacancyFilter) -> dict[str, list[Row]]:
    """Vacancies per value of every faceted field, under all the other filters (not its own)."""
    clauses, faceted, params = f.parts()
    flags = "".join(f", ({clause}) AS f_{name}" for name, clause in faceted.items())

    def others(name: str) -> str:
        return " AND ".join([f"b.f_{n}" for n in faceted if n != name] or ["TRUE"])

    selects = [
        f"SELECT '{name}' AS facet, {column} AS value, count(*) AS vacancies"
        f" FROM b WHERE {others(name)} GROUP BY 2"
        for name, column in FACET_COLUMNS.items()
    ]
    selects.append(
        "SELECT 'focus' AS facet,"
        " coalesce(fo.focus, CASE WHEN b.vpk_category = 'vpk' THEN 'other' END) AS value,"
        " count(DISTINCT b.vacancy_id) AS vacancies"
        f" FROM b LEFT JOIN ({FOCUS_SELECT}) fo ON fo.company_id = b.company_id"
        f" WHERE {others('focus')} GROUP BY 2"
    )
    rows = await session.execute(
        text(f"""
            WITH {CTE},
            b AS (
                SELECT v.vacancy_id, v.company_id, v.region_id, v.source, v.category,
                       v.experience, v.schedule, v.employment,
                       v.direction_domain, v.direction_role, c.vpk_category{flags}
                FROM v LEFT JOIN ({CLASSIFICATION_SELECT}) c ON c.company_id = v.company_id
                WHERE {" AND ".join(clauses)}
            )
            {" UNION ALL ".join(selects)}
        """),
        params,
    )
    out: dict[str, list[Row]] = {name: [] for name in [*FACET_COLUMNS, "focus"]}
    for r in rows.mappings():
        if r["facet"] == "focus" and r["value"] is None:
            continue  # not a ВПК company: no focus to filter by
        out[r["facet"]].append({"value": r["value"], "vacancies": r["vacancies"]})
    for values in out.values():
        values.sort(key=lambda x: (-x["vacancies"], str(x["value"])))
    return out


LIST_COLUMNS = """
    v.vacancy_id AS id, v.source, v.url, v.card_id AS employer_id, v.employer_name, v.title,
    v.locality, v.region_id, r.name AS region, v.salary_from, v.salary_to, v.salary_currency, v.salary_period,
    v.monthly_salary, v.experience, v.schedule, v.employment, v.published_at, v.level, v.category,
    v.final_category, v.final_basis, v.has_markers,
    v.direction_domain, v.direction_role, v.domain_confidence, v.role_confidence,
    v.direction_review, v.direction_model
"""


async def list_vacancies(
    session: AsyncSession, f: VacancyFilter, sort: Sort, limit: int, offset: int
) -> tuple[int, list[Row]]:
    where, params = f.where()
    order = {
        "salary": "v.monthly_salary DESC NULLS LAST, v.vacancy_id",
        "published": "v.published_at DESC NULLS LAST, v.vacancy_id DESC",
        "confirmed": "v.final_level = 'confirmed' DESC, v.published_at DESC NULLS LAST, v.vacancy_id DESC",
    }[sort]
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
