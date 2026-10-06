from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

Level = Literal["confirmed", "likely", "review", "no", "out_of_scope"]


class EmployerOut(BaseModel):
    """An employer from job sites with at least one vacancy classified as ВПК."""

    id: int
    name: str
    source: str
    inn: str | None
    profile_url: str | None
    vpk_vacancies: int
    confirmed_vacancies: int
    total_vacancies: int
    new_30d: int
    median_salary: float | None
    category: str | None
    locality: str | None
    region_id: int | None
    region: str | None
    last_published_at: datetime | None
    gur_company_id: int | None
    gur_name: str | None
    sanctions_count: int


class MapPointOut(BaseModel):
    employer_id: int
    lat: float
    lng: float
    locality: str | None
    region_id: int | None
    vacancies: int


class MonthPoint(BaseModel):
    month: date
    vacancies: int


class ProfessionOut(BaseModel):
    title: str
    vacancies: int
    employers: int | None = None
    median_salary: float | None
    category: str | None = None


class LocalityOut(BaseModel):
    locality: str
    region: str | None
    vacancies: int


class SanctionOut(BaseModel):
    jurisdiction: str
    jurisdiction_name: str | None
    listed_on: date | None


class RelationOut(BaseModel):
    kind: Literal["parent", "bank", "related", "successor", "supplier"]
    direction: Literal["out", "in"]
    company_id: int
    name: str
    inn: str | None
    sanctions_count: int
    employer_id: int | None


class GurCompanyOut(BaseModel):
    """Company card from the GUR «War and sanctions» portal, matched to the employer by INN."""

    company_id: int
    name: str
    name_full_uk: str
    name_full_ru: str | None
    inn: str | None
    ogrn: str | None
    address_uk: str | None
    description_uk: str | None
    products_uk: list[str] | None
    website: str | None
    logo_url: str | None
    gur_url: str | None
    sanctions_count: int
    sanctions_count_intl: int
    sanctions: list[SanctionOut]
    relations: list[RelationOut]


class EmployerDetailOut(EmployerOut):
    monthly: list[MonthPoint]
    professions: list[ProfessionOut]
    localities: list[LocalityOut]
    gur: GurCompanyOut | None


class VacancyOut(BaseModel):
    id: int
    source: str
    url: str
    employer_id: int | None
    employer_name: str | None
    title: str
    locality: str | None
    region_id: int | None
    region: str | None
    salary_from: float | None
    salary_to: float | None
    salary_currency: str | None
    salary_period: str | None
    monthly_salary: float | None
    experience: str | None
    schedule: str | None
    employment: str | None
    published_at: datetime | None
    level: Level
    category: str | None


class VacancyDetailOut(VacancyOut):
    address: str | None
    description: str | None
    responsibilities: str | None
    requirements: str | None
    conditions: str | None
    skills_raw: str | None
    education: str | None


class VacancyPage(BaseModel):
    total: int
    items: list[VacancyOut]


class SourceCount(BaseModel):
    source: str
    vacancies: int
    vpk_vacancies: int


class LevelCount(BaseModel):
    level: Level
    vacancies: int


class CategoryCount(BaseModel):
    category: str | None
    vacancies: int


class RegionOut(BaseModel):
    region_id: int
    name: str
    vpk_vacancies: int
    employers: int


class StatsOut(BaseModel):
    as_of: datetime | None
    vacancies: int
    vpk_vacancies: int
    confirmed_vacancies: int
    vpk_employers: int
    regions: int
    median_salary: float | None
    gur_companies: int
    sanctioned_companies: int
    company_relations: int
    matched_employers: int
    by_source: list[SourceCount]
    by_level: list[LevelCount]
    by_category: list[CategoryCount]
    regions_list: list[RegionOut]
    monthly: list[MonthPoint]
