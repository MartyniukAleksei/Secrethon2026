from fastapi import APIRouter, HTTPException

from app.api.deps import Session
from app.api.employers import EMPLOYER_TTL_SECONDS
from app.api.schemas import EnterpriseOut
from app.repository import employers
from app.repository.cache import cache

router = APIRouter(prefix="/enterprises", tags=["enterprises"])


@router.get("/{company_id}")
async def get_enterprise(company_id: int, session: Session) -> EnterpriseOut:
    """A legal entity without vacancies: the same blocks as a card, without hiring.
    `card_url` is set when the company has an employer card after all."""

    async def load() -> EnterpriseOut | None:
        row = await employers.get_enterprise(session, company_id)
        return EnterpriseOut.model_validate(row) if row else None

    enterprise = await cache.get_or_load(("enterprise", company_id), load, ttl=EMPLOYER_TTL_SECONDS)
    if enterprise is None:
        raise HTTPException(status_code=404, detail="company not found")
    return enterprise
