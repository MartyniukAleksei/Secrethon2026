from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.repository.sql import AGENCY, AS_OF, CLASSIFICATION, CTE, FINAL_RUN, ON_GUR, SHOWN, VPK

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
               (SELECT max(started_at) FROM classifier_run WHERE classifier = '{FINAL_RUN}')
                   AS final_run_at,
               count(*) AS vacancies,
               count(*) FILTER (WHERE {VPK}) AS vpk_vacancies,
               count(*) FILTER (WHERE {VPK} AND final_level = 'confirmed') AS confirmed_vacancies,
               count(*) FILTER (WHERE {VPK} AND final_level = 'likely') AS on_review_vacancies,
               count(DISTINCT card_id) FILTER (WHERE {VPK}) AS vpk_employers,
               -- Job-site profiles → enterprise cards → legal entities behind ВПК vacancies.
               count(DISTINCT employer_profile_id) FILTER (WHERE {VPK}) AS vpk_profiles,
               count(DISTINCT company_id) FILTER (WHERE {VPK}) AS vpk_legal_entities,
               count(monthly_salary) FILTER (WHERE {VPK}) AS salary_samples,
               count(DISTINCT region_id) FILTER (WHERE {VPK}) AS regions,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY monthly_salary) FILTER (WHERE {VPK}) AS median_salary,
               -- Recruitment agencies hiring for the ВПК: their pages and vacancies, counted apart.
               count(DISTINCT card_id) FILTER (WHERE {AGENCY}) AS agency_employers,
               count(*) FILTER (WHERE {AGENCY}) AS agency_vacancies
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
                       AS foreign_intermediary_companies,
                   count(*) FILTER (WHERE vpk_category = 'foreign_intermediary' AND vpk_level = 'decided')
                       AS foreign_intermediary_decided
            FROM latest
        """)
    )
    # Found → deduplicated → screened out → on review / confirmed → cards → legal entities
    # → ВПК decided → on the GUR portal: one funnel from one final run.
    funnel = await one(f"""
        SELECT (SELECT count(*) FROM vacancy WHERE is_active) AS collected,
               count(*) AS unique_vacancies,
               count(*) FILTER (WHERE vc.category = 'excluded') AS excluded,
               count(*) FILTER (WHERE vc.category <> 'excluded' AND vc.level = 'no') AS no_signal,
               count(*) FILTER (WHERE vc.category = 'agency' AND vc.level <> 'no') AS agency,
               count(*) FILTER (WHERE vc.category = 'vpk' AND vc.level = 'likely') AS likely,
               count(*) FILTER (WHERE vc.category = 'vpk' AND vc.level = 'confirmed') AS confirmed
        FROM vacancy_unique u
        JOIN vacancy_classification vc USING (vacancy_id)
        JOIN classifier_run r USING (run_id)
        WHERE r.classifier = '{FINAL_RUN}' AND u.is_active
    """)
    funnel.update(
        await one(f"""
            WITH {CTE}, {CLASSIFICATION}
            SELECT count(DISTINCT v.company_id) FILTER (WHERE cls.vpk_level = 'decided') AS decided,
                   count(DISTINCT v.company_id)
                       FILTER (WHERE cls.vpk_level = 'decided' AND c.{ON_GUR}) AS on_gur
            FROM v
            JOIN cls ON cls.company_id = v.company_id AND cls.vpk_category = 'vpk'
            JOIN company c ON c.company_id = v.company_id
            WHERE {VPK}
        """)
    )
    funnel["cards"] = totals["vpk_employers"]
    funnel["legal_entities"] = totals["vpk_legal_entities"]
    totals["funnel"] = funnel
    totals["by_source"] = await many(f"""
        WITH {CTE}
        SELECT source, count(*) AS vacancies, count(*) FILTER (WHERE {VPK}) AS vpk_vacancies
        FROM v GROUP BY source ORDER BY count(*) DESC
    """)
    totals["by_level"] = await many(f"""
        WITH {CTE} SELECT level, count(*) AS vacancies FROM v GROUP BY level ORDER BY count(*) DESC
    """)
    totals["by_basis"] = await many(f"""
        WITH {CTE}
        SELECT final_category AS category, final_basis AS basis, count(*) AS vacancies
        FROM v WHERE {SHOWN}
        GROUP BY final_category, final_basis ORDER BY count(*) DESC
    """)
    totals["by_category"] = await many(f"""
        WITH {CTE}
        SELECT category, count(*) AS vacancies FROM v WHERE {VPK}
        GROUP BY category ORDER BY count(*) DESC
    """)
    totals["regions_list"] = await many(f"""
        WITH {CTE}
        SELECT r.region_id, r.name, count(v.vacancy_id) AS vpk_vacancies,
               count(DISTINCT v.card_id) AS employers
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
