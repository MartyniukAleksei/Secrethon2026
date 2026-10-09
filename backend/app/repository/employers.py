from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.repository.sql import (
    AS_OF,
    CARD_OF,
    CLASSIFICATION,
    CTE,
    EMPLOYER_SELECT,
    FOCUS,
    HUMAN_REVIEW_FIELDS,
    LISTED,
    ON_GUR,
    SHOWN,
    with_human_review,
)
from app.reviews import employer_reviews_ready, list_employer_reviews

Row = dict[str, Any]

# company_edge kinds the card shows (RelationOut.kind); other kinds are skipped, not an error.
RELATION_KINDS = ("parent", "bank", "related", "successor", "supplier", "branch")


async def map_points(session: AsyncSession) -> list[Row]:
    """Hiring locations from active shown vacancies (ВПК and agencies); never infer company addresses."""
    result = await session.execute(
        text(f"""
            WITH {CTE}
            SELECT card_id AS employer_id, lat, lng,
                   min(locality) AS locality, min(region_id) AS region_id,
                   count(*) AS vacancies
            FROM v
            WHERE {SHOWN} AND employer_profile_id IS NOT NULL
              AND lat BETWEEN -85 AND 85 AND lng BETWEEN -180 AND 180
            GROUP BY card_id, lat, lng
            ORDER BY card_id, lat, lng
        """)
    )
    return [dict(r) for r in result.mappings()]


# Where a card's company is by the register (company_site): a head card shows all of its
# company's sites, a branch card only the branches in its region (KPP starts with the region).
CARD_SITES = """
    JOIN employer_group eg ON eg.employer_profile_id = cards.card_id
    JOIN company_site s ON s.company_id = eg.company_id
    WHERE (NOT eg.is_branch OR (s.kind = 'branch' AND left(s.kpp, 2) = eg.branch_key))
"""
SITE_COLUMNS = "s.kind, s.name, s.address, s.lat::float AS lat, s.lng::float AS lng, s.geo_qc"
# DaData qc_geo up to 3 (a settlement): coarser points (a whole city) would mislead on a map.
SITE_ON_MAP = "s.lat IS NOT NULL AND coalesce(s.geo_qc, 5) <= 3"


async def map_sites(session: AsyncSession) -> list[Row]:
    """Head offices and branches of the employers on the map, from the register."""
    result = await session.execute(
        text(f"""
            WITH {CTE},
            cards AS (SELECT DISTINCT card_id FROM v WHERE {SHOWN} AND employer_profile_id IS NOT NULL)
            SELECT DISTINCT eg.group_id AS employer_id, {SITE_COLUMNS}
            FROM cards {CARD_SITES} AND {SITE_ON_MAP}
            ORDER BY employer_id, s.kind DESC, s.name
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
    """Employers with at least one shown vacancy (ВПК or through an agency), biggest first."""
    sql = await _employer_select(session)
    result = await session.execute(
        text(
            sql + f" AND {LISTED}"
            " ORDER BY a.vpk_vacancies DESC, a.agency_vacancies DESC, eg.group_id"
        )
    )
    employers = [_employer_row(r) for r in result.mappings()]
    await _attach_classifications(session, employers)
    return employers


async def _attach_classifications(session: AsyncSession, employers: list[Row]) -> None:
    """Short company classification, focus and agency decision for list cards, as on the page."""
    # Same legal entity as get_employer: the card's group, else the GUR card by INN.
    for e in employers:
        e["company_id"] = e["company_id"] or e["gur_company_id"]

    company_ids = sorted({e["company_id"] for e in employers if e["company_id"] is not None})
    classifications = await session.execute(
        text(f"""
            WITH {CLASSIFICATION}
            SELECT company_id, vpk_category, vpk_probability, vpk_level, direction_domain,
                   direction_role, direction_label, direction_secondary, reliability,
                   reliability_note, sanctions_gur, sanctions_new
            FROM cls WHERE company_id = ANY(:ids)
        """),
        {"ids": company_ids},
    )
    by_company = {}
    for r in classifications.mappings():
        row = dict(r)
        by_company[row.pop("company_id")] = row
    focus = await _focus(session, company_ids)
    conflicts = await session.execute(
        text("SELECT DISTINCT employer_profile_id FROM employer_match_conflict")
    )
    conflicted = {r.employer_profile_id for r in conflicts}

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

    # Logo of the GUR card shown on the company page: by INN first, else the matched company.
    logo_ids = sorted({i for e in employers if (i := e["gur_company_id"] or e["company_id"])})
    logos = await session.execute(
        text("""
            SELECT company_id, logo_url FROM company
            WHERE company_id = ANY(:ids) AND nullif(btrim(logo_url), '') IS NOT NULL
        """),
        {"ids": logo_ids},
    )
    logo_by_company = {r.company_id: r.logo_url for r in logos}

    for e in employers:
        company_id = e.pop("company_id")
        e["classification"] = by_company.get(company_id)
        e["focus"] = _vpk_focus(e["classification"], focus.get(company_id))
        e["match_conflict"] = any(p in conflicted for p in e.pop("profile_ids"))
        e.pop("profile_inn", None)
        e["agency"] = by_employer.get(e["id"]) if company_id is None else None
        e["logo_url"] = logo_by_company.get(e["gur_company_id"] or company_id)


async def _focus(session: AsyncSession, company_ids: list[int]) -> dict[int, list[Row]]:
    result = await session.execute(
        text(f"""
            WITH {FOCUS}
            SELECT * FROM focus WHERE company_id = ANY(:ids) ORDER BY company_id, focus
        """),
        {"ids": company_ids},
    )
    by_company: dict[int, list[Row]] = {}
    for r in result.mappings():
        row = dict(r)
        by_company.setdefault(row.pop("company_id"), []).append(row)
    return by_company


def _vpk_focus(classification: Row | None, focus: list[Row] | None) -> list[Row] | None:
    """Focus tags of a ВПК company (an empty list means "adjacent"); None for any other card."""
    if not classification or classification["vpk_category"] != "vpk":
        return None
    return focus or []


async def map_network(session: AsyncSession) -> Row:
    """Recorded profile relationships and product tags; the map resolves coordinates separately."""
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
            WHERE e.kind = ANY(:kinds)
            ORDER BY e.kind, e.company_id, e.related_id
        """),
        {"kinds": list(RELATION_KINDS)},
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


async def card_of(session: AsyncSession, profile_id: int) -> int | None:
    """The card (group's main profile) a job-site profile belongs to; None for an unknown id."""
    result = await session.execute(
        text(f"SELECT {CARD_OF} FROM employer_profile WHERE employer_profile_id = :id"),
        {"id": profile_id},
    )
    return result.scalar_one_or_none()


async def get_employer(session: AsyncSession, employer_id: int) -> Row | None:
    """The card of any profile of the group: `id` of the result is the card (may differ)."""
    card_id = await card_of(session, employer_id)
    if card_id is None:
        return None
    sql = await _employer_select(session)
    result = await session.execute(text(sql + " AND eg.group_id = :id"), {"id": card_id})
    row = result.mappings().first()
    if row is None:
        return None
    employer = _employer_row(row)
    employer_id = card_id
    profile_ids = employer.pop("profile_ids")
    employer["human_reviews"] = await list_employer_reviews(session, profile_ids)
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
            LEFT JOIN v ON v.card_id = :id AND {SHOWN}
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
            FROM v WHERE card_id = :id AND {SHOWN}
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
            WHERE v.card_id = :id AND v.locality IS NOT NULL AND {SHOWN}
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
                WHERE v.card_id = :id AND {SHOWN}
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

    sites = await session.execute(
        text(f"""
            WITH cards AS (SELECT CAST(:id AS bigint) AS card_id)
            SELECT DISTINCT {SITE_COLUMNS}, ({SITE_ON_MAP}) AS on_map
            FROM cards {CARD_SITES}
            ORDER BY s.kind DESC, s.name
        """),
        params,
    )
    employer["sites"] = [dict(r) for r in sites.mappings()]

    # The legal entity behind the card: the group's, else the GUR card found by INN.
    company_id = employer["company_id"] or employer["gur_company_id"]
    link = await _company_link(session, employer_id, profile_ids, company_id)
    # By INN only when the main profile itself carries it (hh cards take the company's INN).
    by_inn = employer.pop("profile_inn") is not None and employer["gur_company_id"] is not None
    sure = by_inn or link is None or link["status"] == "auto"
    gur_id = employer["gur_company_id"]
    if gur_id is None and link is not None and link["on_gur"]:
        gur_id = company_id
    employer["gur"] = await _gur_company(session, gur_id)
    if employer["gur"] is not None:
        employer["gur"]["match"] = "inn" if by_inn else "auto" if sure else "name"

    employer["company_id"] = company_id
    employer["company_link"] = None
    if company_id is not None:
        employer["company_link"] = "auto" if sure else "candidate"
    employer["logo_url"] = employer["gur"]["logo_url"] if employer["gur"] else None
    employer["profile"] = await _company_profile(session, company_id)
    employer["classification"] = await _company_classification(session, company_id)
    employer["focus"] = _vpk_focus(
        employer["classification"],
        (await _focus(session, [company_id])).get(company_id) if company_id else None,
    )
    employer["registry"] = await _company_registry(session, company_id)
    employer["contacts"] = await _company_contacts(session, company_id, profile_ids)
    employer["agency"] = (
        await _employer_agency(session, employer_id) if company_id is None else None
    )
    employer["sources"] = await _card_sources(session, employer_id)
    employer["parent_card_id"] = (
        await _parent_card(session, company_id) if employer["is_branch"] else None
    )
    employer["match_conflicts"] = await _match_conflicts(session, profile_ids)
    return employer


async def _card_sources(session: AsyncSession, card_id: int) -> list[Row]:
    """Job-site profiles of the card, with their shown active vacancies."""
    result = await session.execute(
        text(f"""
            WITH {CTE}
            SELECT ep.employer_profile_id, ep.source, ep.name, ep.url,
                   count(v.vacancy_id) AS vacancies
            FROM employer_group g JOIN employer_profile ep USING (employer_profile_id)
            LEFT JOIN v ON v.employer_profile_id = ep.employer_profile_id AND v.{SHOWN}
            WHERE g.group_id = :id
            GROUP BY 1, 2, 3, 4 ORDER BY vacancies DESC, 1
        """),
        {"id": card_id},
    )
    return [dict(r) for r in result.mappings()]


async def _parent_card(session: AsyncSession, company_id: int | None) -> int | None:
    """The head-office card of a branch: the main card of the company's head-office group."""
    if company_id is None:
        return None
    result = await session.execute(
        text("""
            SELECT group_id FROM employer_group
            WHERE company_id = :cid AND method = 'company' AND is_head
            ORDER BY group_id LIMIT 1
        """),
        {"cid": company_id},
    )
    return result.scalar_one_or_none()


async def _match_conflicts(session: AsyncSession, profile_ids: list[int]) -> list[Row]:
    """Questionable links of the card's profiles to a legal entity, for a person to check."""
    result = await session.execute(
        text("""
            SELECT employer_profile_id, kind, evidence FROM employer_match_conflict
            WHERE employer_profile_id = ANY(:ids) ORDER BY employer_profile_id, kind
        """),
        {"ids": profile_ids},
    )
    return [dict(r) for r in result.mappings()]


async def _company_link(
    session: AsyncSession, card_id: int, profile_ids: list[int], company_id: int | None
) -> Row | None:
    """How the card is linked to its legal entity: the main profile's link first, else any
    profile's ('auto' by INN, or a candidate). Duplicates resolve to their canonical company."""
    if company_id is None:
        return None
    result = await session.execute(
        text(f"""
            SELECT m.status, c.{ON_GUR} AS on_gur
            FROM employer_company_match m
            LEFT JOIN company_duplicate d ON d.company_id = m.company_id
            JOIN company c ON c.company_id = :cid
            WHERE m.employer_profile_id = ANY(:ids) AND m.status <> 'rejected'
              AND coalesce(d.canonical_id, m.company_id) = :cid
            ORDER BY m.employer_profile_id = :card DESC, m.status = 'auto' DESC, m.confidence DESC
            LIMIT 1
        """),
        {"ids": profile_ids, "cid": company_id, "card": card_id},
    )
    row = result.mappings().first()
    if row is not None:
        return dict(row)
    on_gur = await session.execute(
        text(f"SELECT {ON_GUR} FROM company WHERE company_id = :cid"), {"cid": company_id}
    )
    return {"status": "auto", "on_gur": bool(on_gur.scalar_one_or_none())}


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
            SELECT cc.vpk_category, cc.vpk_probability, cc.vpk_level, cc.direction_domain,
                   cc.direction_role, cc.direction_label,
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
    session: AsyncSession, company_id: int | None, profile_ids: list[int]
) -> list[Row]:
    """Verified corporate requisites and contacts, the newest value of each kind first."""
    result = await session.execute(
        text("""
            SELECT kind, value, detail, url FROM (
                SELECT DISTINCT ON (cc.kind, cc.value) cc.kind, cc.value, cc.detail, cc.url,
                       r.started_at
                FROM company_contact cc JOIN enrichment_run r USING (run_id)
                WHERE cc.verified
                  AND (cc.company_id = :cid OR cc.employer_profile_id = ANY(:ids))
                ORDER BY cc.kind, cc.value, r.started_at DESC
            ) c
            ORDER BY kind, started_at DESC, value
        """),
        {"cid": company_id, "ids": profile_ids},
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
    # Kinds the API does not know yet are skipped: a new pipeline kind must not take the card down.
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
            WHERE e.kind = ANY(:kinds)
            ORDER BY e.kind, name
            LIMIT 200
        """),
        {**params, "kinds": list(RELATION_KINDS)},
    )
    gur["relations"] = [dict(r) for r in edges.mappings()]
    return gur
