from fastapi import APIRouter

from app.api import agent, employers, export, health, stats, vacancies

# Everything under /api; the rest of the paths are served as the SPA (see app/main.py).
# Endpoints read the pipeline's database read-only; the only writes are human reviews,
# kept in the app-owned `web_reviews` schema (see app/reviews.py).
router = APIRouter(prefix="/api")
router.include_router(health.router)
router.include_router(stats.router)
router.include_router(employers.router)
router.include_router(vacancies.router)
router.include_router(agent.router)
router.include_router(export.router)
