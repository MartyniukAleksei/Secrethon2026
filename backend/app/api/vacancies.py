from collections.abc import Callable
from typing import Annotated, get_args

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import SQLAlchemyError

from app import reviews
from app.api.deps import Session
from app.api.schemas import (
    FacetValue,
    ProfessionOut,
    VacancyDetailOut,
    VacancyOut,
    VacancyPage,
    VacancyReviewIn,
    VacancyReviewOut,
)
from app.repository import vacancies
from app.repository.cache import cache
from app.repository.vacancies import Focus, LevelFilter, Scope, Sort, VacancyFilter

router = APIRouter(tags=["vacancies"])


FOCUS_VALUES = set(get_args(Focus))
# A comma-separated list: `region_id=64,77` is either of the two regions.
ListParam = Annotated[str | None, Query(max_length=2000)]


def split(raw: str | None, name: str, allowed: set[str] | None = None) -> tuple[str, ...]:
    values = tuple(x.strip() for x in (raw or "").split(",") if x.strip())
    if allowed is not None and (bad := [x for x in values if x not in allowed]):
        raise HTTPException(status_code=422, detail=f"unknown {name}: {', '.join(bad)}")
    return values


def filter_params(default_scope: Scope = "vpk") -> Callable[..., VacancyFilter]:
    """Query parameters of the vacancy filter, shared by the list, professions and export."""

    def params(
        level: LevelFilter = "vpk",
        employer_id: int | None = None,
        region_id: ListParam = None,
        category: ListParam = None,
        title: str | None = None,
        q: Annotated[str | None, Query(max_length=200)] = None,
        days: Annotated[int | None, Query(ge=1, le=3650)] = None,
        scope: Scope = default_scope,
        markers: bool = False,
        focus: ListParam = None,
        domain: ListParam = None,
        role: ListParam = None,
        source: ListParam = None,
        experience: ListParam = None,
        schedule: ListParam = None,
        employment: ListParam = None,
        salary_min: Annotated[int | None, Query(ge=0)] = None,
        salary_max: Annotated[int | None, Query(ge=0)] = None,
        with_salary: bool = False,
    ) -> VacancyFilter:
        regions = split(region_id, "region_id")
        if not all(r.lstrip("-").isdigit() for r in regions):
            raise HTTPException(status_code=422, detail="region_id must be integers")
        return VacancyFilter(
            level=level,
            employer_id=employer_id,
            region_id=tuple(int(r) for r in regions),
            category=split(category, "category"),
            title=title,
            q=(q or "").strip() or None,
            days=days,
            scope=scope,
            markers=markers,
            focus=split(focus, "focus", FOCUS_VALUES),  # type: ignore[arg-type]
            domain=split(domain, "domain"),
            role=split(role, "role"),
            source=split(source, "source"),
            experience=split(experience, "experience"),
            schedule=split(schedule, "schedule"),
            employment=split(employment, "employment"),
            salary_min=salary_min,
            salary_max=salary_max,
            with_salary=with_salary,
        )

    return params


Filter = Annotated[VacancyFilter, Depends(filter_params())]


@router.get("/vacancies")
async def list_vacancies(
    session: Session,
    f: Filter,
    sort: Sort = "confirmed",
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> VacancyPage:
    """Shown vacancies: of ВПК enterprises (`scope=vpk`), recruitment agencies, or both."""
    total, rows = await vacancies.list_vacancies(session, f, sort, limit, offset)
    return VacancyPage(total=total, items=[VacancyOut.model_validate(r) for r in rows])


@router.get("/vacancies/facets")
async def vacancy_facets(session: Session, f: Filter) -> dict[str, list[FacetValue]]:
    """Vacancies per value of each filter field (region, source, experience…), counted under
    all the other filters, as a filter sidebar shows them."""

    async def load() -> dict[str, list[FacetValue]]:
        return {
            k: [FacetValue.model_validate(x) for x in v]
            for k, v in (await vacancies.facets(session, f)).items()
        }

    return await cache.get_or_load(("vacancy-facets", f), load)


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
    f: Filter,
    limit: Annotated[int, Query(ge=1, le=200)] = 60,
) -> list[ProfessionOut]:
    """Most demanded job titles among the filtered vacancies."""
    return [
        ProfessionOut.model_validate(r) for r in await vacancies.list_professions(session, f, limit)
    ]
