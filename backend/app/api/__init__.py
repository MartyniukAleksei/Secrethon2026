from fastapi import APIRouter

from app.api import agent, employers, export, health, stats, vacancies

# Everything under /api; the rest of the paths are served as the SPA (see app/main.py).
# All endpoints are read-only: the database belongs to the data pipeline.
router = APIRouter(prefix="/api")
router.include_router(health.router)
router.include_router(stats.router)
router.include_router(employers.router)
router.include_router(vacancies.router)
router.include_router(agent.router)
router.include_router(export.router)
