from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.repository.sql import AS_OF, CTE, ON_GUR, VPK

Row = dict[str, Any]


async def overview(session: AsyncSession) -> Row:
    """Headline numbers and breakdowns for the landing page and filters."""

    async def one(sql: str) -> Row:
        return dict((await session.execute(text(sql))).mappings().one())

    async def many(sql: str) -> list[Row]:
        return [dict(r) for r in (await session.execute(text(sql))).mappings()]

    totals = await one(f"""
        WITH {CTE}
        SELECT {AS_OF} AS as_of,
               count(*) AS vacancies,
               count(*) FILTER (WHERE {VPK}) AS vpk_vacancies,
               count(*) FILTER (WHERE level = 'confirmed') AS confirmed_vacancies,
               count(DISTINCT employer_profile_id) FILTER (WHERE {VPK}) AS vpk_employers,
               count(DISTINCT region_id) FILTER (WHERE {VPK}) AS regions,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY monthly_salary) FILTER (WHERE {VPK}) AS median_salary
        FROM v
    """)
    totals.update(
        await one(f"""
            SELECT count(*) AS gur_companies,
                   count(*) FILTER (WHERE sanctions_count > 0) AS sanctioned_companies,
                   (SELECT count(*) FROM company_edge) AS company_relations,
                   (SELECT count(DISTINCT ep.employer_profile_id) FROM employer_profile ep
                    JOIN company c ON c.inn = ep.inn AND c.{ON_GUR}) AS matched_employers
            FROM company
            WHERE {ON_GUR}
        """)
    )
    # Only 'vpk' counts as a ВПК enterprise; agencies and foreign intermediaries are counted apart.
    totals.update(
        await one("""
            WITH latest AS (
                SELECT DISTINCT ON (cc.company_id) cc.vpk_category, cc.vpk_level
                FROM company_classification cc JOIN classifier_run r USING (run_id)
                WHERE r.classifier = 'company_classification'
                ORDER BY cc.company_id, r.started_at DESC
            )
            SELECT count(*) FILTER (WHERE vpk_category = 'vpk') AS vpk_companies,
                   count(*) FILTER (WHERE vpk_category = 'vpk' AND vpk_level = 'decided')
                       AS vpk_companies_decided,
                   count(*) FILTER (WHERE vpk_category = 'agency_vpk') AS agency_vpk_companies,
                   count(*) FILTER (WHERE vpk_category = 'foreign_intermediary')
                       AS foreign_intermediary_companies
            FROM latest
        """)
    )
    totals.update(
        await one(f"""
            WITH {CTE},
            agency AS (
                SELECT employer_profile_id FROM (
                    SELECT DISTINCT ON (ec.employer_profile_id) ec.employer_profile_id, ec.category
                    FROM employer_classification ec JOIN classifier_run r USING (run_id)
                    WHERE r.classifier = 'employer_agency'
                    ORDER BY ec.employer_profile_id, r.started_at DESC
                ) a
                WHERE category = 'agency_vpk'
            )
            SELECT (SELECT count(*) FROM agency) AS agency_employers,
                   count(v.vacancy_id) AS agency_vacancies
            FROM v JOIN agency USING (employer_profile_id)
            WHERE {VPK}
        """)
    )
    totals["by_source"] = await many(f"""
        WITH {CTE}
        SELECT source, count(*) AS vacancies, count(*) FILTER (WHERE {VPK}) AS vpk_vacancies
        FROM v GROUP BY source ORDER BY count(*) DESC
    """)
    totals["by_level"] = await many(f"""
        WITH {CTE} SELECT level, count(*) AS vacancies FROM v GROUP BY level ORDER BY count(*) DESC
    """)
    totals["by_category"] = await many(f"""
        WITH {CTE}
        SELECT category, count(*) AS vacancies FROM v WHERE {VPK}
        GROUP BY category ORDER BY count(*) DESC
    """)
    totals["regions_list"] = await many(f"""
        WITH {CTE}
        SELECT r.region_id, r.name, count(v.vacancy_id) AS vpk_vacancies,
               count(DISTINCT v.employer_profile_id) AS employers
        FROM region r JOIN v ON v.region_id = r.region_id AND {VPK}
        GROUP BY r.region_id, r.name ORDER BY count(v.vacancy_id) DESC
    """)
    totals["monthly"] = await many(f"""
        WITH {CTE},
        months AS (
            SELECT generate_series(date_trunc('month', {AS_OF}) - interval '11 months',
                                   date_trunc('month', {AS_OF}), interval '1 month')::date AS month
        )
        SELECT m.month, count(v.vacancy_id) AS vacancies
        FROM months m
        LEFT JOIN v ON {VPK} AND date_trunc('month', v.published_at)::date = m.month
        GROUP BY m.month ORDER BY m.month
    """)
    return totals
