"""Numbers for the «Про дані» page: how records were matched and deduplicated, what classes
there are and how many of each, and how the decisions were verified (script checks, the LLM
judge, human reviews). All of it reads the pipeline's tables; nothing is computed in the app.
"""

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.repository.sql import CLASSIFICATION_SELECT, FINAL_RUN, FOCUS_SELECT


async def _rows(session: AsyncSession, sql: str) -> list[dict[str, Any]]:
    return [dict(r) for r in (await session.execute(text(sql))).mappings()]


async def _exists(session: AsyncSession, table: str) -> bool:
    return await session.scalar(text(f"SELECT to_regclass('{table}')")) is not None


async def overview(session: AsyncSession) -> dict[str, Any]:
    matching = await _rows(
        session,
        """
        SELECT CASE WHEN status IN ('auto', 'verified') THEN status
                    WHEN confidence >= 0.8 THEN 'candidate_sure'
                    ELSE 'candidate_weak' END AS kind,
               count(DISTINCT employer_profile_id) AS profiles
        FROM employer_company_match WHERE status <> 'rejected'
        GROUP BY 1 ORDER BY 2 DESC
        """,
    )
    methods = await _rows(
        session,
        """
        SELECT method, count(*) AS links FROM employer_company_match
        WHERE status <> 'rejected' GROUP BY 1 ORDER BY 2 DESC LIMIT 12
        """,
    )
    dedup = (
        (
            await session.execute(
                text(
                    """
                SELECT
                  (SELECT count(*) FROM vacancy) AS vacancies,
                  (SELECT count(*) FROM vacancy_duplicate WHERE method LIKE 'repost%') AS reposts,
                  (SELECT count(*) FROM vacancy_duplicate WHERE method = 'cross_source')
                      AS cross_source,
                  (SELECT count(*) FROM employer_group) AS profiles,
                  (SELECT count(DISTINCT group_id) FROM employer_group) AS cards,
                  (SELECT count(*) FROM employer_group WHERE is_branch) AS branch_profiles,
                  (SELECT count(*) FROM company) AS companies,
                  (SELECT count(*) FROM company_duplicate) AS company_duplicates,
                  (SELECT count(*) FROM company_edge WHERE source = 'dedup') AS branch_edges
                """
                )
            )
        )
        .mappings()
        .one()
    )
    companies = await _rows(
        session,
        f"""
        SELECT vpk_category AS category, vpk_level AS level, decided_by, count(*) AS n
        FROM ({CLASSIFICATION_SELECT}) c GROUP BY 1, 2, 3 ORDER BY 4 DESC
        """,
    )
    vacancies = await _rows(
        session,
        f"""
        SELECT vc.category, vc.level, count(*) AS n
        FROM vacancy_classification vc JOIN classifier_run r USING (run_id)
        JOIN vacancy_unique v USING (vacancy_id)
        WHERE r.classifier = '{FINAL_RUN}' AND v.is_active
        GROUP BY 1, 2 ORDER BY 3 DESC
        """,
    )
    focus = await _rows(
        session, f"SELECT focus, basis, count(*) AS n FROM ({FOCUS_SELECT}) f GROUP BY 1, 2"
    )
    checks = (
        (
            await session.execute(
                text(
                    """
                SELECT
                  (SELECT count(*) FROM company_fact WHERE quote_verified) AS facts_verified,
                  (SELECT count(*) FROM company_fact WHERE NOT quote_verified) AS facts_rejected,
                  (SELECT count(*) FROM company_contact WHERE verified) AS contacts_verified,
                  (SELECT count(*) FROM company_contact WHERE NOT verified) AS contacts_rejected,
                  (SELECT count(*) FROM company_profile WHERE status = 'published') AS profiles,
                  (SELECT count(*) FROM company_sanction_found) AS sanctions_found
                """
                )
            )
        )
        .mappings()
        .one()
    )
    return {
        "matching": matching,
        "match_methods": methods,
        "dedup": dict(dedup),
        "companies": companies,
        "vacancies": vacancies,
        "focus": focus,
        "checks": dict(checks),
        "judge": await judge(session),
        "human": await human(session),
    }


async def judge(session: AsyncSession) -> dict[str, Any] | None:
    """The latest LLM-as-a-judge run: agreement by kind and stratum, and the disagreements."""
    if not await _exists(session, "judge_review"):
        return None
    run = (
        (
            await session.execute(
                text(
                    "SELECT run_id, version, params->>'model' AS model, started_at FROM classifier_run"
                    " WHERE classifier = 'llm_judge' ORDER BY started_at DESC LIMIT 1"
                )
            )
        )
        .mappings()
        .first()
    )
    if run is None:
        return None
    strata = await _rows(
        session,
        f"""
        SELECT item_kind AS kind, stratum, count(*) AS n,
               count(*) FILTER (WHERE agree) AS agree, count(*) FILTER (WHERE agree_vpk) AS agree_vpk
        FROM judge_review WHERE run_id = {int(run["run_id"])}
        GROUP BY 1, 2 ORDER BY 1, 3 DESC
        """,
    )
    disagreements = await _rows(
        session,
        f"""
        SELECT j.item_kind AS kind, j.item_id, j.stratum, j.our_label, j.judge_label,
               j.confidence, j.reason,
               CASE WHEN j.item_kind = 'company'
                    THEN coalesce(c.name_short_ru, c.name_full_ru, c.name_full_uk)
                    ELSE v.title || ' — ' || coalesce(v.employer_name, '') END AS name,
               CASE WHEN j.item_kind = 'company' THEN (
                    SELECT min(g.group_id) FROM employer_group g
                    WHERE g.company_id = j.item_id AND g.is_head) END AS card_id
        FROM judge_review j
        LEFT JOIN company c ON j.item_kind = 'company' AND c.company_id = j.item_id
        LEFT JOIN vacancy v ON j.item_kind = 'vacancy' AND v.vacancy_id = j.item_id
        WHERE j.run_id = {int(run["run_id"])} AND NOT j.agree_vpk
        ORDER BY j.confidence DESC NULLS LAST, j.item_kind, j.item_id
        LIMIT 30
        """,
    )
    return {**dict(run), "strata": strata, "disagreements": disagreements}


async def human(session: AsyncSession) -> dict[str, int]:
    """Saved human reviews (the table appears with the first review)."""
    out = {"employer_reviews": 0, "employer_cards": 0, "vacancy_human": 0, "vacancy_llm": 0}
    if await _exists(session, "web_reviews.employer_review"):
        row = (
            await session.execute(
                text(
                    "SELECT count(*), count(DISTINCT employer_id) FROM web_reviews.employer_review"
                )
            )
        ).one()
        out["employer_reviews"], out["employer_cards"] = row
    if await _exists(session, "web_reviews.vacancy_review"):
        for source, n in await session.execute(
            text("SELECT source, count(*) FROM web_reviews.vacancy_review GROUP BY 1")
        ):
            out[f"vacancy_{source}"] = n
    return out
