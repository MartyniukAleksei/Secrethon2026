from fastapi import APIRouter

from app.api.deps import Session
from app.api.schemas import StatsOut
from app.repository import stats
from app.repository.cache import cache

router = APIRouter(tags=["stats"])


@router.get("/stats")
async def get_stats(session: Session) -> StatsOut:
    return await cache.get_or_load("stats", lambda: _load(session))


async def _load(session: Session) -> StatsOut:
    return StatsOut.model_validate(await stats.overview(session))
