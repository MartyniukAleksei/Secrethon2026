from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.api.deps import Session
from app.repository import discovery
from app.repository.cache import cache

router = APIRouter(prefix="/discovery", tags=["discovery"])

Status = Literal["fact", "no_fact", "contact", "query"]


class DiscoveryCount(BaseModel):
    provider: str
    status: Status
    rows: int
    first_at: datetime | None
    last_at: datetime | None


class DiscoveryEntry(BaseModel):
    log_id: int
    company_id: int | None
    company_name: str | None
    # The company's card on the site, when it has one.
    card_id: int | None
    provider: str
    query: str | None
    url: str | None
    title: str | None
    snippet: str | None
    published: str | None
    found_at: datetime | None
    status: Status


class DiscoveryPage(BaseModel):
    total: int
    items: list[DiscoveryEntry]


@router.get("/summary")
async def summary(session: Session) -> list[DiscoveryCount]:
    """Search log rows by provider and status ("Як ми шукали")."""

    async def load() -> list[DiscoveryCount]:
        return [DiscoveryCount.model_validate(r) for r in await discovery.summary(session)]

    return await cache.get_or_load("discovery-summary", load)


@router.get("")
async def entries(
    session: Session,
    company_id: int | None = None,
    provider: Annotated[str | None, Query(max_length=40)] = None,
    status: Status | None = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> DiscoveryPage:
    """Searches and results by company (`q`: company name, any alphabet)."""
    total, rows = await discovery.entries(
        session,
        company_id=company_id,
        provider=provider,
        status=status,
        q=(q or "").strip() or None,
        limit=limit,
        offset=offset,
    )
    return DiscoveryPage(total=total, items=[DiscoveryEntry.model_validate(r) for r in rows])
