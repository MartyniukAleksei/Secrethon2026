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
)
from app.export_snapshot import snapshots
from app.repository import employers
from app.repository.cache import cache

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

    employer = await cache.get_or_load(("employer", employer_id), load)
    if employer is None:
        raise HTTPException(status_code=404, detail="employer not found")
    return employer


@router.post("/{employer_id}/reviews", status_code=201)
async def add_review(
    employer_id: int, review: EmployerReviewIn, session: Session
) -> EmployerReviewOut:
    """Append a human review; the latest one overrides the card's automatic values."""
    if await employers.get_employer(session, employer_id) is None:
        raise HTTPException(status_code=404, detail="employer not found")
    try:
        row = await reviews.save_employer_review(employer_id, review.model_dump())
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=503, detail="review storage unavailable; the review was not saved"
        ) from exc
    cache.invalidate("employers", ("employer", employer_id))
    snapshots.invalidate()
    return EmployerReviewOut.model_validate(row)
