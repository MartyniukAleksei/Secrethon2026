from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import SQLAlchemyError

from app import reviews
from app.api.deps import Session
from app.api.schemas import (
    EmployerDetailOut,
    EmployerOut,
    EmployerReviewIn,
    EmployerReviewOut,
    MapNetworkOut,
    MapPointOut,
    MapSiteOut,
)
from app.export_snapshot import snapshots
from app.repository import employers
from app.repository.cache import cache

# Company classification, profiles and contacts are replaced while classifier runs go on.
EMPLOYER_TTL_SECONDS = 180

router = APIRouter(prefix="/employers", tags=["employers"])


@router.get("")
async def list_employers(session: Session) -> list[EmployerOut]:
    """All employers with ВПК vacancies (a few thousand rows; the UI filters client-side)."""

    async def load() -> list[EmployerOut]:
        return [EmployerOut.model_validate(r) for r in await employers.list_employers(session)]

    return await cache.get_or_load("employers", load)


@router.get("/map-points")
async def map_points(session: Session) -> list[MapPointOut]:
    async def load() -> list[MapPointOut]:
        return [MapPointOut.model_validate(r) for r in await employers.map_points(session)]

    return await cache.get_or_load("map-points", load)


@router.get("/map-sites")
async def map_sites(session: Session) -> list[MapSiteOut]:
    """Head offices and branches by the register: a separate layer from the hiring places."""

    async def load() -> list[MapSiteOut]:
        return [MapSiteOut.model_validate(r) for r in await employers.map_sites(session)]

    return await cache.get_or_load("map-sites", load)


@router.get("/map-network")
async def map_network(session: Session) -> MapNetworkOut:
    async def load() -> MapNetworkOut:
        return MapNetworkOut.model_validate(await employers.map_network(session))

    return await cache.get_or_load("map-network", load)


@router.get("/{employer_id}")
async def get_employer(employer_id: int, session: Session) -> EmployerDetailOut:
    async def load() -> EmployerDetailOut | None:
        row = await employers.get_employer(session, employer_id)
        return EmployerDetailOut.model_validate(row) if row else None

    employer = await cache.get_or_load(("employer", employer_id), load, ttl=EMPLOYER_TTL_SECONDS)
    if employer is None:
        raise HTTPException(status_code=404, detail="employer not found")
    return employer


@router.post("/{employer_id}/reviews", status_code=201)
async def add_review(
    employer_id: int, review: EmployerReviewIn, session: Session
) -> EmployerReviewOut:
    """Append a human review; the latest one overrides the card's automatic values."""
    # Saved under the card, whichever profile of the group the request names.
    card_id = await employers.card_of(session, employer_id)
    if card_id is None:
        raise HTTPException(status_code=404, detail="employer not found")
    try:
        row = await reviews.save_employer_review(card_id, review.model_dump())
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=503, detail="review storage unavailable; the review was not saved"
        ) from exc
    cache.invalidate("employers", ("employer", employer_id), ("employer", card_id))
    snapshots.invalidate()
    return EmployerReviewOut.model_validate(row)
