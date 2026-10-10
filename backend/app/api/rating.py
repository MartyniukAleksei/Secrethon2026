from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from app.api.deps import Session
from app.api.schemas import (
    RatingDetailOut,
    RatingListOut,
    RatingMetaOut,
    RatingUnitOut,
)
from app.repository import rating
from app.repository.cache import cache
from app.search import fold, variants

# The pipeline recounts the rating while the site runs: read the latest run every few minutes.
RATING_TTL_SECONDS = 180

Focus = Literal["drone", "missile", "kab"]
Tier = Literal["bom", "evidence", "peer"]

router = APIRouter(prefix="/rating", tags=["rating"])


async def _rows(session: Session) -> tuple[dict | None, list[dict]]:
    """The latest run and all its ranked companies (about two thousand rows, filtered here)."""

    async def load() -> tuple[dict | None, list[dict]]:
        run = await rating.latest_run(session)
        if run is None:
            return None, []
        rows = await rating.list_rows(session, run["run_id"])
        for row in rows:
            row["folded"] = fold(row["name"] or "")
        return run, rows

    return await cache.get_or_load("rating", load, ttl=RATING_TTL_SECONDS)


def _run(run: dict) -> dict:
    return {k: run[k] for k in ("run_id", "version", "started_at")}


async def ranked(
    session: Session,
    focus: Focus | None = None,
    tier: Tier | None = None,
    domain: str | None = None,
    region: str | None = None,
    q: str | None = None,
) -> tuple[dict | None, list[dict], dict]:
    """Filtered rows of the latest run, numbered in their order (`position`), and the facets."""
    run, rows = await _rows(session)
    if focus:
        rows = sorted(
            (r for r in rows if (r["score_by_focus"] or {}).get(focus, 0) > 0),
            key=lambda r: (-r["score_by_focus"][focus], r["rank"]),
        )
    rows = [{**r, "position": i} for i, r in enumerate(rows, 1)]
    facets = {
        "domains": sorted({r["direction_domain"] or "unknown" for r in rows}),
        "regions": sorted({g for r in rows for g in r["regions"]}),
    }
    if tier:
        rows = [r for r in rows if r["tier"] == tier]
    if domain:
        rows = [r for r in rows if (r["direction_domain"] or "unknown") == domain]
    if region:
        rows = [r for r in rows if region in r["regions"]]
    if q and q.strip():
        needles = variants(q)
        digits = q.strip()
        rows = [
            r
            for r in rows
            if any(n in r["folded"] for n in needles)
            or (digits.isdigit() and r["inn"] and digits in r["inn"])
        ]
    return run, rows, facets


@router.get("")
async def list_rating(
    session: Session,
    focus: Focus | None = None,
    tier: Tier | None = None,
    domain: str | None = None,
    region: str | None = None,
    q: str | None = None,
    limit: int = Query(100, ge=1, le=3000),
    offset: int = Query(0, ge=0),
) -> RatingListOut:
    """Ranked companies; with `focus`, only those contributing to it, by that contribution."""
    run, rows, facets = await ranked(session, focus, tier, domain, region, q)
    return RatingListOut.model_validate(
        {
            "run": _run(run) if run else None,
            "total": len(rows),
            "items": rows[offset : offset + limit],
            "facets": facets,
        }
    )


@router.get("/meta")
async def rating_meta(session: Session) -> RatingMetaOut:
    """Model parameters, systems and weights, checks and weak points of the latest run."""

    async def load() -> RatingMetaOut | None:
        run = await rating.latest_run(session)
        if run is None:
            return None
        params = run["params"] or {}
        checks = params.get("checks") or {}
        ids = {
            c["company_id"]
            for c in [*(checks.get("anchors") or []), *(checks.get("external") or [])]
            if c.get("company_id") is not None
        }
        urls = await rating.page_urls(session, sorted(ids))
        return RatingMetaOut.model_validate({"run": _run(run), "params": params, "urls": urls})

    meta = await cache.get_or_load("rating-meta", load, ttl=RATING_TTL_SECONDS)
    if meta is None:
        raise HTTPException(status_code=404, detail="no rating run")
    return meta


@router.get("/units")
async def rating_units(
    session: Session, kind: Literal["domain", "region", "holding"]
) -> list[RatingUnitOut]:
    """Industries, regions and holdings scored as one supplier each."""

    async def load() -> list[RatingUnitOut]:
        run = await rating.latest_run(session)
        if run is None:
            return []
        return [
            RatingUnitOut.model_validate(r)
            for r in await rating.units(session, run["run_id"], kind)
        ]

    return await cache.get_or_load(("rating-units", kind), load, ttl=RATING_TTL_SECONDS)


@router.get("/{company_id}")
async def rating_detail(company_id: int, session: Session) -> RatingDetailOut:
    """Why the score: the breakdown, plus the supply chain and accounts of the company."""

    async def load() -> RatingDetailOut | None:
        extras = await rating.extras(session, company_id)
        if extras["rating"] is None:
            return None
        urls = await rating.page_urls(session, [company_id])
        return RatingDetailOut.model_validate({**extras, "url": urls[company_id]})

    detail = await cache.get_or_load(("rating", company_id), load, ttl=RATING_TTL_SECONDS)
    if detail is None:
        raise HTTPException(status_code=404, detail="company is not ranked")
    return detail
