from fastapi import APIRouter, HTTPException

from app.api.deps import Session
from app.api.schemas import EmployerDetailOut, EmployerOut, MapNetworkOut, MapPointOut
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
