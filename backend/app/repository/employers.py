from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.repository.sql import AS_OF, CTE, EMPLOYER_SELECT, VPK

Row = dict[str, Any]


async def map_points(session: AsyncSession) -> list[Row]:
    """Hiring locations from active VPK vacancies; never infer company addresses."""
    result = await session.execute(
        text(f"""
            WITH {CTE}
            SELECT employer_profile_id AS employer_id, lat, lng,
                   min(locality) AS locality, min(region_id) AS region_id,
                   count(*) AS vacancies
            FROM v
            WHERE {VPK} AND employer_profile_id IS NOT NULL
              AND lat BETWEEN -85 AND 85 AND lng BETWEEN -180 AND 180
            GROUP BY employer_profile_id, lat, lng
            ORDER BY employer_profile_id, lat, lng
        """)
    )
    return [dict(r) for r in result.mappings()]


async def list_employers(session: AsyncSession) -> list[Row]:
    """Employers with at least one ВПК vacancy, biggest first."""
    result = await session.execute(
        text(EMPLOYER_SELECT + " WHERE a.vpk_vacancies > 0 ORDER BY a.vpk_vacancies DESC, a.id")
    )
    return [dict(r) for r in result.mappings()]


async def get_employer(session: AsyncSession, employer_id: int) -> Row | None:
    result = await session.execute(text(EMPLOYER_SELECT + " WHERE a.id = :id"), {"id": employer_id})
    row = result.mappings().first()
    if row is None:
        return None
    employer = dict(row)
    params = {"id": employer_id}

    monthly = await session.execute(
        text(f"""
            WITH {CTE},
            months AS (
                SELECT generate_series(
                    date_trunc('month', {AS_OF}) - interval '11 months',
                    date_trunc('month', {AS_OF}),
                    interval '1 month'
                )::date AS month
            )
            SELECT m.month, count(v.vacancy_id) AS vacancies
            FROM months m
            LEFT JOIN v ON v.employer_profile_id = :id AND {VPK}
                       AND date_trunc('month', v.published_at)::date = m.month
            GROUP BY m.month ORDER BY m.month
        """),
        params,
    )
    employer["monthly"] = [dict(r) for r in monthly.mappings()]

    professions = await session.execute(
        text(f"""
            WITH {CTE}
            SELECT title, count(*) AS vacancies,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY monthly_salary) AS median_salary
            FROM v WHERE employer_profile_id = :id AND {VPK}
            GROUP BY title ORDER BY count(*) DESC, title LIMIT 15
        """),
        params,
    )
    employer["professions"] = [dict(r) for r in professions.mappings()]

    localities = await session.execute(
        text(f"""
            WITH {CTE}
            SELECT v.locality, r.name AS region, count(*) AS vacancies
            FROM v LEFT JOIN region r ON r.region_id = v.region_id
            WHERE v.employer_profile_id = :id AND v.locality IS NOT NULL AND {VPK}
            GROUP BY v.locality, r.name ORDER BY count(*) DESC LIMIT 6
        """),
        params,
    )
    employer["localities"] = [dict(r) for r in localities.mappings()]

    employer["gur"] = await _gur_company(session, employer["gur_company_id"])
    return employer


# Names of a related company's role, seen from the profile it was listed on (GUR profile sections).
async def _gur_company(session: AsyncSession, company_id: int | None) -> Row | None:
    if company_id is None:
        return None
    params = {"cid": company_id}
    company = (
        (
            await session.execute(
                text("""
                    SELECT c.company_id, coalesce(c.name_short_uk, c.name_full_uk) AS name, c.name_full_uk,
                           c.name_full_ru, c.inn, c.ogrn, c.address_uk, c.description_uk, c.products_uk,
                           c.website, c.logo_url, c.sanctions_count, c.sanctions_count_intl,
                           (SELECT url_uk FROM company_section s WHERE s.company_id = c.company_id
                            ORDER BY s.section LIMIT 1) AS gur_url
                    FROM company c WHERE c.company_id = :cid
                """),
                params,
            )
        )
        .mappings()
        .first()
    )
    if company is None:
        return None
    gur = dict(company)

    sanctions = await session.execute(
        text("""
            SELECT s.jurisdiction, j.name_uk AS jurisdiction_name, s.listed_on
            FROM company_sanction s LEFT JOIN sanction_jurisdiction j ON j.code = s.jurisdiction
            WHERE s.company_id = :cid AND s.is_sanctioned
            ORDER BY s.listed_on NULLS LAST, s.jurisdiction
        """),
        params,
    )
    gur["sanctions"] = [dict(r) for r in sanctions.mappings()]

    # Edges are stored as listed on a company's GUR profile: (company_id, related_id, kind) means
    # "on company_id's profile, related_id appears as <kind>". Direction "out" = seen from this company.
    edges = await session.execute(
        text("""
            WITH edges AS (
                SELECT e.related_id AS other_id, e.kind, 'out' AS direction FROM company_edge e WHERE e.company_id = :cid
                UNION
                SELECT e.company_id, e.kind, 'in' FROM company_edge e WHERE e.related_id = :cid
            )
            SELECT e.kind, e.direction, c.company_id, coalesce(c.name_short_uk, c.name_full_uk) AS name,
                   c.inn, c.sanctions_count,
                   (SELECT ep.employer_profile_id FROM employer_profile ep
                    WHERE ep.inn = c.inn ORDER BY ep.employer_profile_id LIMIT 1) AS employer_id
            FROM edges e JOIN company c ON c.company_id = e.other_id
            ORDER BY e.kind, name
            LIMIT 200
        """),
        params,
    )
    gur["relations"] = [dict(r) for r in edges.mappings()]
    return gur
