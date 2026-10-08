from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.repository.sql import (
    AS_OF,
    CTE,
    EMPLOYER_SELECT,
    HUMAN_REVIEW_FIELDS,
    ON_GUR,
    VPK,
    with_human_review,
)
from app.reviews import employer_reviews_ready, list_employer_reviews

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


async def _employer_select(session: AsyncSession) -> str:
    return with_human_review(EMPLOYER_SELECT, await employer_reviews_ready(session))


def _employer_row(row: Any) -> Row:
    """Fold the flat `human_*` columns into a nested `human_review` (None when never reviewed)."""
    employer = dict(row)
    review = {c: employer.pop(f"human_{c}") for c in HUMAN_REVIEW_FIELDS}
    employer["human_review"] = (
        {**review, "employer_id": employer["id"]} if review["review_id"] is not None else None
    )
    return employer


async def list_employers(session: AsyncSession) -> list[Row]:
    """Employers with at least one ВПК vacancy, biggest first."""
    sql = await _employer_select(session)
    result = await session.execute(
        text(sql + " WHERE a.vpk_vacancies > 0 ORDER BY a.vpk_vacancies DESC, a.id")
    )
    employers = [_employer_row(r) for r in result.mappings()]
    await _attach_classifications(session, employers)
    return employers


async def _attach_classifications(session: AsyncSession, employers: list[Row]) -> None:
    """Short company classification and agency decision for list cards, as on the company page."""
    # Same legal entity as get_employer: the best confident match, else the GUR card by INN.
    matches = await session.execute(
        text("""
            SELECT DISTINCT ON (m.employer_profile_id) m.employer_profile_id,
                   coalesce(d.canonical_id, m.company_id) AS company_id
            FROM employer_company_match m
            LEFT JOIN company_duplicate d ON d.company_id = m.company_id
            WHERE m.status <> 'rejected' AND (m.status = 'auto' OR m.confidence >= 0.8)
            ORDER BY m.employer_profile_id, m.status = 'auto' DESC, m.confidence DESC, 2
        """)
    )
    company_by_employer = {r.employer_profile_id: r.company_id for r in matches}
    for e in employers:
        e["company_id"] = company_by_employer.get(e["id"], e["gur_company_id"])

    company_ids = sorted({e["company_id"] for e in employers if e["company_id"] is not None})
    classifications = await session.execute(
        text("""
            SELECT DISTINCT ON (cc.company_id) cc.company_id, cc.vpk_category, cc.vpk_probability,
                   cc.vpk_level, cc.direction_label, cc.direction_secondary, cc.reliability,
                   cc.reliability_note, cc.sanctions_gur, cc.sanctions_new
            FROM company_classification cc JOIN classifier_run r USING (run_id)
            WHERE r.classifier = 'company_classification' AND cc.company_id = ANY(:ids)
            ORDER BY cc.company_id, r.started_at DESC
        """),
        {"ids": company_ids},
    )
    by_company = {}
    for r in classifications.mappings():
        row = dict(r)
        by_company[row.pop("company_id")] = row

    agencies = await session.execute(
        text("""
            SELECT DISTINCT ON (ec.employer_profile_id) ec.employer_profile_id,
                   ec.category, ec.level, ec.score, ec.raw_label
            FROM employer_classification ec JOIN classifier_run r USING (run_id)
            WHERE r.classifier = 'employer_agency'
            ORDER BY ec.employer_profile_id, r.started_at DESC
        """)
    )
    by_employer = {}
    for r in agencies.mappings():
        row = dict(r)
        by_employer[row.pop("employer_profile_id")] = row

    for e in employers:
        company_id = e.pop("company_id")
        e["classification"] = by_company.get(company_id)
        e["agency"] = by_employer.get(e["id"]) if company_id is None else None


async def map_network(session: AsyncSession) -> Row:
    """Profile relationships and product tags; coordinates stay vacancy-derived."""
    relations = await session.execute(
        text("""
            SELECT e.company_id, e.related_id, e.kind,
                   coalesce(c.name_short_uk, c.name_full_uk) AS company_name,
                   coalesce(r.name_short_uk, r.name_full_uk) AS related_name,
                   e.source, e.label, e.evidence_url,
                   (SELECT s.url_uk FROM company_section s WHERE s.company_id = e.company_id
                    ORDER BY s.section LIMIT 1) AS profile_url
            FROM company_edge e
            JOIN company c ON c.company_id = e.company_id
            JOIN company r ON r.company_id = e.related_id
            WHERE e.kind IN ('supplier', 'parent')
            ORDER BY e.kind, e.company_id, e.related_id
        """)
    )
    tags = await session.execute(
        text("""
            WITH tagged AS (
                SELECT c.company_id,
                       EXISTS (SELECT 1 FROM company_uav_model u WHERE u.company_id = c.company_id) AS uav,
                       EXISTS (SELECT 1 FROM company_weapon w WHERE w.company_id = c.company_id)
                       OR EXISTS (SELECT 1 FROM company_weapon_component p WHERE p.company_id = c.company_id) AS weapons
                FROM company c
            )
            SELECT * FROM tagged WHERE uav OR weapons ORDER BY company_id
        """)
    )
    return {
        "relations": [dict(r) for r in relations.mappings()],
        "company_tags": [dict(r) for r in tags.mappings()],
    }


async def get_employer(session: AsyncSession, employer_id: int) -> Row | None:
    sql = await _employer_select(session)
    result = await session.execute(text(sql + " WHERE a.id = :id"), {"id": employer_id})
    row = result.mappings().first()
    if row is None:
        return None
    employer = _employer_row(row)
    employer["human_reviews"] = await list_employer_reviews(session, employer_id)
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

    hiring_locations = await session.execute(
        text(f"""
            WITH {CTE}, places AS (
                SELECT nullif(btrim(vac.address), '') AS address,
                       nullif(btrim(v.locality), '') AS locality,
                       CASE WHEN v.lat BETWEEN -85 AND 85 AND v.lng BETWEEN -180 AND 180
                            THEN v.lat END AS lat,
                       CASE WHEN v.lat BETWEEN -85 AND 85 AND v.lng BETWEEN -180 AND 180
                            THEN v.lng END AS lng,
                       v.source, v.vacancy_id, v.url AS vacancy_url, v.published_at
                FROM v JOIN vacancy vac USING (vacancy_id)
                WHERE v.employer_profile_id = :id AND {VPK}
            )
            SELECT DISTINCT ON (source, address, locality, lat, lng)
                   address, locality, lat, lng, source, vacancy_id, vacancy_url
            FROM places
            WHERE address IS NOT NULL OR locality IS NOT NULL OR lat IS NOT NULL
            ORDER BY source, address, locality, lat, lng, published_at DESC NULLS LAST,
                     vacancy_id DESC
        """),
        params,
    )
    employer["hiring_locations"] = [dict(r) for r in hiring_locations.mappings()]

    match = await _matched_company(session, employer_id)
    gur_id, gur_match = employer["gur_company_id"], "inn"
    if gur_id is None and match is not None and match["on_gur"]:
        gur_id, gur_match = match["company_id"], "auto" if match["status"] == "auto" else "name"
    employer["gur"] = await _gur_company(session, gur_id)
    if employer["gur"] is not None:
        employer["gur"]["match"] = gur_match

    # The legal entity behind the page: the matched company, else the GUR card found by INN.
    company_id = match["company_id"] if match is not None else gur_id
    employer["company_id"] = company_id
    employer["company_link"] = None
    if company_id is not None:
        by_inn = company_id == employer["gur_company_id"]
        sure = by_inn or match is None or match["status"] == "auto"
        employer["company_link"] = "auto" if sure else "candidate"
    employer["profile"] = await _company_profile(session, company_id)
    employer["classification"] = await _company_classification(session, company_id)
    employer["registry"] = await _company_registry(session, company_id)
    employer["contacts"] = await _company_contacts(session, company_id, employer_id)
    employer["agency"] = (
        await _employer_agency(session, employer_id) if company_id is None else None
    )
    return employer


async def _matched_company(session: AsyncSession, employer_id: int) -> Row | None:
    """Best company link for the employer: 'auto' (by INN) or any non-rejected link with confidence >= 0.8.

    Duplicates are resolved to their canonical company row.
    """
    result = await session.execute(
        text(f"""
            WITH best AS (
                SELECT coalesce(d.canonical_id, m.company_id) AS company_id, m.status, m.confidence
                FROM employer_company_match m
                LEFT JOIN company_duplicate d ON d.company_id = m.company_id
                WHERE m.employer_profile_id = :id
                  AND m.status <> 'rejected' AND (m.status = 'auto' OR m.confidence >= 0.8)
                ORDER BY m.status = 'auto' DESC, m.confidence DESC, company_id
                LIMIT 1
            )
            -- on_gur: the company has a GUR portal card, not only registry data.
            SELECT b.company_id, b.status, c.{ON_GUR} AS on_gur
            FROM best b JOIN company c USING (company_id)
        """),
        {"id": employer_id},
    )
    row = result.mappings().first()
    return dict(row) if row else None


async def _company_profile(session: AsyncSession, company_id: int | None) -> Row | None:
    """Latest published open-source profile, with only the facts whose quotes were verified."""
    if company_id is None:
        return None
    statuses = ["published", "draft"] if settings.profiles_include_drafts else ["published"]
    result = await session.execute(
        text("""
            WITH prof AS (
                SELECT p.company_id, p.run_id, p.activity_tags, p.products_ru, p.description_ru,
                       p.created_at, er.started_at AS updated_at, er.method AS origin
                FROM company_profile p JOIN enrichment_run er USING (run_id)
                WHERE p.company_id = :cid AND p.status = ANY(:statuses)
                ORDER BY er.started_at DESC, p.run_id DESC
                LIMIT 1
            )
            SELECT prof.*,
                   coalesce(json_agg(json_build_object(
                       'n', f.local_id, 'url', f.url, 'quote', f.quote, 'claim', f.claim_ru,
                       'source_type', f.source_type, 'grade', f.grade) ORDER BY f.local_id)
                     FILTER (WHERE f.fact_id IS NOT NULL), '[]') AS sources
            FROM prof
            LEFT JOIN company_fact f
                   ON f.company_id = prof.company_id AND f.run_id = prof.run_id
                  AND f.quote_verified
            GROUP BY prof.company_id, prof.run_id, prof.activity_tags, prof.products_ru,
                     prof.description_ru, prof.created_at, prof.updated_at, prof.origin
        """),
        {"cid": company_id, "statuses": statuses},
    )
    row = result.mappings().first()
    return dict(row) if row else None


async def _company_classification(session: AsyncSession, company_id: int | None) -> Row | None:
    """Final ВПК decision for the company from the latest classification run."""
    if company_id is None:
        return None
    result = await session.execute(
        text("""
            SELECT cc.vpk_category, cc.vpk_probability, cc.vpk_level, cc.direction_label,
                   cc.direction_secondary, cc.reliability, cc.reliability_note,
                   cc.sanctions_gur, cc.sanctions_new, cc.explanation, cc.enrichment_run_id
            FROM company_classification cc JOIN classifier_run r USING (run_id)
            WHERE r.classifier = 'company_classification' AND cc.company_id = :cid
            ORDER BY r.started_at DESC LIMIT 1
        """),
        {"cid": company_id},
    )
    row = result.mappings().first()
    if row is None:
        return None
    classification = dict(row)
    # Sanctions found outside GUR, each backed by a verified fact of the same search run.
    sanctions = await session.execute(
        text("""
            WITH run AS (
                SELECT coalesce(CAST(:run_id AS int), (
                    SELECT s.run_id FROM company_sanction_found s
                    JOIN enrichment_run er USING (run_id)
                    WHERE s.company_id = :cid ORDER BY er.started_at DESC LIMIT 1)) AS run_id
            )
            SELECT s.jurisdiction, s.list_name, s.listed_raw, s.in_gur, min(f.url) AS url
            FROM company_sanction_found s
            JOIN run USING (run_id)
            JOIN company_fact f ON f.run_id = s.run_id AND f.company_id = s.company_id
                               AND f.local_id = s.local_fact_id AND f.quote_verified
            WHERE s.company_id = :cid
            GROUP BY s.jurisdiction, s.list_name, s.listed_raw, s.in_gur
            ORDER BY s.jurisdiction, s.list_name
        """),
        {"cid": company_id, "run_id": classification.pop("enrichment_run_id")},
    )
    classification["sanctions_found"] = [dict(r) for r in sanctions.mappings()]
    return classification


async def _company_registry(session: AsyncSession, company_id: int | None) -> Row | None:
    if company_id is None:
        return None
    result = await session.execute(
        text("SELECT address, head FROM company_registry WHERE company_id = :cid"),
        {"cid": company_id},
    )
    row = result.mappings().first()
    return dict(row) if row else None


async def _company_contacts(
    session: AsyncSession, company_id: int | None, employer_id: int
) -> list[Row]:
    """Verified corporate requisites and contacts, the newest value of each kind first."""
    result = await session.execute(
        text("""
            SELECT kind, value, detail, url FROM (
                SELECT DISTINCT ON (cc.kind, cc.value) cc.kind, cc.value, cc.detail, cc.url,
                       r.started_at
                FROM company_contact cc JOIN enrichment_run r USING (run_id)
                WHERE cc.verified
                  AND (cc.company_id = :cid OR cc.employer_profile_id = :id)
                ORDER BY cc.kind, cc.value, r.started_at DESC
            ) c
            ORDER BY kind, started_at DESC, value
        """),
        {"cid": company_id, "id": employer_id},
    )
    return [dict(r) for r in result.mappings()]


async def _employer_agency(session: AsyncSession, employer_id: int) -> Row | None:
    """Recruitment-agency decision for a page that has no legal entity."""
    result = await session.execute(
        text("""
            SELECT ec.category, ec.level, ec.score, ec.raw_label
            FROM employer_classification ec JOIN classifier_run r USING (run_id)
            WHERE r.classifier = 'employer_agency' AND ec.employer_profile_id = :id
            ORDER BY r.started_at DESC LIMIT 1
        """),
        {"id": employer_id},
    )
    row = result.mappings().first()
    return dict(row) if row else None


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
                           c.name_full_ru, c.inn, c.ogrn, c.kpp, c.address_uk, c.description_uk, c.products_uk,
                           array_remove(ARRAY[
                               CASE WHEN EXISTS (SELECT 1 FROM company_uav_model u WHERE u.company_id = c.company_id)
                                    THEN 'БпЛА' END,
                               CASE WHEN EXISTS (SELECT 1 FROM company_weapon w WHERE w.company_id = c.company_id)
                                    THEN 'Озброєння' END,
                               CASE WHEN EXISTS (SELECT 1 FROM company_weapon_component p WHERE p.company_id = c.company_id)
                                    THEN 'Компоненти озброєння' END
                           ], NULL) AS activity_tags,
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
