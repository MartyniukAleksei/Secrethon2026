from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy.exc import SQLAlchemyError

from app import reviews
from app.api.deps import Session
from app.api.schemas import (
    ProfessionOut,
    VacancyDetailOut,
    VacancyOut,
    VacancyPage,
    VacancyReviewIn,
    VacancyReviewOut,
)
from app.repository import vacancies
from app.repository.vacancies import LevelFilter, Scope, Sort, VacancyFilter

router = APIRouter(tags=["vacancies"])


def _filter(
    level: LevelFilter = "vpk",
    employer_id: int | None = None,
    region_id: int | None = None,
    category: str | None = None,
    title: str | None = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    days: Annotated[int | None, Query(ge=1, le=3650)] = None,
    scope: Scope = "vpk",
    markers: bool = False,
) -> VacancyFilter:
    return VacancyFilter(
        level=level,
        employer_id=employer_id,
        region_id=region_id,
        category=category,
        title=title,
        q=(q or "").strip() or None,
        days=days,
        scope=scope,
        markers=markers,
    )


@router.get("/vacancies")
async def list_vacancies(
    session: Session,
    level: LevelFilter = "vpk",
    employer_id: int | None = None,
    region_id: int | None = None,
    category: str | None = None,
    title: str | None = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    days: Annotated[int | None, Query(ge=1, le=3650)] = None,
    scope: Scope = "vpk",
    markers: bool = False,
    sort: Sort = "published",
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> VacancyPage:
    """Shown vacancies: of ВПК enterprises (`scope=vpk`), recruitment agencies, or both."""
    f = _filter(level, employer_id, region_id, category, title, q, days, scope, markers)
    total, rows = await vacancies.list_vacancies(session, f, sort, limit, offset)
    return VacancyPage(total=total, items=[VacancyOut.model_validate(r) for r in rows])


@router.get("/vacancies/{vacancy_id}")
async def get_vacancy(vacancy_id: int, session: Session) -> VacancyDetailOut:
    row = await vacancies.get_vacancy(session, vacancy_id)
    if row is None:
        raise HTTPException(status_code=404, detail="vacancy not found")
    row["reviews"] = await reviews.list_reviews(session, vacancy_id)
    return VacancyDetailOut.model_validate(row)


@router.post("/vacancies/{vacancy_id}/reviews", status_code=201)
async def add_review(
    vacancy_id: int, review: VacancyReviewIn, session: Session
) -> VacancyReviewOut:
    if await vacancies.get_vacancy(session, vacancy_id) is None:
        raise HTTPException(status_code=404, detail="vacancy not found")
    try:
        row = await reviews.save_review(vacancy_id, review.model_dump())
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=503, detail="review storage unavailable; the review was not saved"
        ) from exc
    return VacancyReviewOut.model_validate(row)


@router.get("/professions")
async def list_professions(
    session: Session,
    level: LevelFilter = "vpk",
    region_id: int | None = None,
    category: str | None = None,
    days: Annotated[int | None, Query(ge=1, le=3650)] = None,
    scope: Scope = "vpk",
    markers: bool = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 60,
) -> list[ProfessionOut]:
    """Most demanded job titles among the filtered vacancies."""
    f = _filter(level, None, region_id, category, None, None, days, scope, markers)
    return [
        ProfessionOut.model_validate(r) for r in await vacancies.list_professions(session, f, limit)
    ]
