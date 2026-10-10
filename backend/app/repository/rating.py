"""Importance rating of ВПК companies (`company-rating` of the pipeline, migrations 0015–0020).

Every request reads the latest `importance_rating` run: a recount replaces the whole picture.
A ranked legal entity opens as its employer card when it has one, else as /enterprises/{id}.
"""

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

Row = dict[str, Any]

LATEST_RUN = """(SELECT run_id FROM classifier_run WHERE classifier = 'importance_rating'
                 ORDER BY run_id DESC LIMIT 1)"""

# The card of a legal entity: its head-office group, not a branch.
CARD_ID = """(SELECT g.group_id FROM employer_group g
              WHERE g.company_id = {cid} AND g.is_head AND NOT g.is_branch
              ORDER BY g.group_id LIMIT 1)"""


def page_url(card_id: int | None, company_id: int) -> str:
    return f"/companies/{card_id}" if card_id is not None else f"/enterprises/{company_id}"


async def latest_run(session: AsyncSession) -> Row | None:
    result = await session.execute(
        text(f"""
            SELECT run_id, version, started_at, params FROM classifier_run
            WHERE run_id = {LATEST_RUN}
        """)
    )
    row = result.mappings().first()
    return dict(row) if row else None


async def list_rows(session: AsyncSession, run_id: int) -> list[Row]:
    """All ranked companies of the run, in rank order, without the (heavy) breakdown."""
    result = await session.execute(
        text(f"""
            SELECT r.rank, r.company_id, r.score, r.score_by_focus, r.rank_med, r.rank_lo,
                   r.rank_hi, r.tier, r.p_vpk,
                   coalesce(c.name_short_uk, c.name_short_ru, c.name_full_uk, c.name_full_ru)
                       AS name,
                   coalesce(c.inn, reg.inn) AS inn,
                   cc.direction_domain, cc.direction_label,
                   coalesce((SELECT array_agg(DISTINCT s.region ORDER BY s.region)
                             FROM company_site s
                             WHERE s.company_id = r.company_id AND s.region IS NOT NULL),
                            '{{}}') AS regions,
                   d.status AS disclosure,
                   {CARD_ID.format(cid="r.company_id")} AS card_id
            FROM company_rating r
            JOIN company c USING (company_id)
            LEFT JOIN company_registry reg USING (company_id)
            LEFT JOIN company_classification cc ON cc.company_id = r.company_id
              AND cc.run_id = (SELECT max(run_id) FROM classifier_run
                               WHERE classifier = 'company_classification')
            LEFT JOIN company_disclosure d ON d.company_id = r.company_id AND d.source = 'gir_bo'
            WHERE r.run_id = :run
            ORDER BY r.rank
        """),
        {"run": run_id},
    )
    rows = []
    for r in result.mappings():
        row = dict(r)
        row["url"] = page_url(row.pop("card_id"), row["company_id"])
        rows.append(row)
    return rows


async def units(session: AsyncSession, run_id: int, kind: str) -> list[Row]:
    result = await session.execute(
        text("""
            SELECT unit, score, score_by_focus, hhi, members FROM rating_unit
            WHERE run_id = :run AND kind = :kind ORDER BY score DESC
        """),
        {"run": run_id, "kind": kind},
    )
    return [dict(r) for r in result.mappings()]


async def page_urls(session: AsyncSession, company_ids: list[int]) -> dict[int, str]:
    """Where each company opens on the site (for the companies named in the run's checks)."""
    if not company_ids:
        return {}
    result = await session.execute(
        text(f"""
            SELECT c.company_id, {CARD_ID.format(cid="c.company_id")} AS card_id
            FROM company c WHERE c.company_id = ANY(:ids)
        """),
        {"ids": company_ids},
    )
    return {r["company_id"]: page_url(r["card_id"], r["company_id"]) for r in result.mappings()}


def _rows(select: str) -> str:
    """A subquery's rows as one json array (each block below is one round trip less)."""
    return f"(SELECT coalesce(json_agg(x), '[]') FROM ({select}) x)"


# What the company makes or supplies for weapon systems: GUR bills of materials (bom), lead
# maker by GUR, cooperation lists without a part, and verified quotes from texts (claims).
SUPPLY_CHAIN = {
    "bom": """
        SELECT w.weapon_slug, coalesce(w.name_uk, w.name_ru) AS system, w.focus,
               p.part_kind, p.name_uk AS part, p.url AS part_url, m.role
        FROM weapon_part_maker m
        JOIN weapon_part p USING (weapon_slug, part_key)
        JOIN weapon w USING (weapon_slug)
        WHERE m.company_id = :cid
        ORDER BY w.focus, system, part""",
    "lead": """
        SELECT weapon_slug, coalesce(name_uk, name_ru) AS system, focus, url
        FROM weapon WHERE lead_company_id = :cid ORDER BY focus, system""",
    "cooperation": """
        SELECT w.weapon_slug, coalesce(w.name_uk, w.name_ru) AS system, w.focus, w.url
        FROM company_weapon cw JOIN weapon w USING (weapon_slug)
        WHERE cw.company_id = :cid ORDER BY w.focus, system""",
    "claims": """
        SELECT s.source, s.role, s.weapon_slug,
               coalesce(w.name_uk, w.name_ru, s.system_text) AS system,
               s.focus, s.part_text, s.quote, s.url
        FROM company_supply s LEFT JOIN weapon w USING (weapon_slug)
        WHERE s.company_id = :cid AND s.verified
          AND s.run_id = (SELECT max(run_id) FROM classifier_run
                          WHERE classifier = 'supply_extract')
        ORDER BY s.weapon_slug IS NULL, system, s.source, s.supply_id""",
}


async def extras(session: AsyncSession, company_id: int) -> Row:
    """Rating row, supply chain, annual accounts (ГИР БО and the few published elsewhere, with
    whether ГИР БО hides them) and GUR portal profiles of a legal entity, in one query."""
    result = await session.execute(
        text(f"""
            SELECT {", ".join(f"{_rows(q)} AS {k}" for k, q in SUPPLY_CHAIN.items())},
                   {
            _rows('''
                       SELECT year, metric, amount, currency, source, source_url
                       FROM company_financial WHERE company_id = :cid
                       ORDER BY year, metric, source''')
        } AS finance_rows,
                   (SELECT row_to_json(d) FROM (
                       SELECT status, last_period, checked_at FROM company_disclosure
                       WHERE company_id = :cid AND source = 'gir_bo') d) AS disclosure,
                   {
            _rows('''
                       SELECT section, url_uk AS url FROM company_section
                       WHERE company_id = :cid ORDER BY section''')
        } AS sections,
                   (SELECT row_to_json(r) FROM (
                       SELECT rank, company_id, score, score_by_focus, rank_med, rank_lo,
                              rank_hi, tier, p_vpk, breakdown,
                              (SELECT count(*) FROM company_rating x
                               WHERE x.run_id = r.run_id) AS ranked
                       FROM company_rating r
                       WHERE company_id = :cid AND run_id = {LATEST_RUN}) r) AS rating
        """),
        {"cid": company_id},
    )
    row = result.mappings().one()
    return {
        "rating": row["rating"],
        "supply_chain": {k: row[k] for k in SUPPLY_CHAIN},
        "finance": {"rows": row["finance_rows"], "disclosure": row["disclosure"]},
        "sections": row["sections"],
    }
