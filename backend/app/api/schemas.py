from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Level = Literal["confirmed", "likely", "review", "no", "out_of_scope"]
HumanSource = Literal[
    "hh", "trudvsem", "superjob", "gur", "registry", "company_site", "media", "other"
]


class EmployerReviewIn(BaseModel):
    """A human snapshot of the employer card; a missing field keeps the automatic value."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    sources: list[HumanSource] | None = Field(default=None, min_length=1, max_length=8)
    # Admiralty code letter: A reliable … E unreliable, F cannot be judged.
    reliability: Literal["A", "B", "C", "D", "E", "F"] | None = None
    category: Literal["производство", "НИИ/КБ", "ремонт"] | None = None
    sanctions: Literal["sanctioned", "not_sanctioned"] | None = None
    vpk: Literal["confirmed", "likely", "no"] | None = None
    reviewed_by: str = Field(min_length=2, max_length=120)
    comment: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _reviews_something(self) -> "EmployerReviewIn":
        if self.sources is not None:
            self.sources = list(dict.fromkeys(self.sources))
        fields = (self.sources, self.reliability, self.category, self.sanctions, self.vpk)
        if all(v is None for v in fields):
            raise ValueError("set at least one reviewed value")
        return self


class EmployerReviewOut(EmployerReviewIn):
    review_id: int
    employer_id: int
    reviewed_at: datetime


class CompanyClassificationBriefOut(BaseModel):
    """Final ВПК decision for the legal entity (latest `company_classification` run)."""

    vpk_category: str
    vpk_probability: float | None
    vpk_level: Literal["decided", "review"]
    # Industry and role of the company (filters «Галузь» and «Роль»).
    direction_domain: str | None = None
    direction_role: str | None = None
    direction_label: str | None
    direction_secondary: str | None
    reliability: str | None
    reliability_note: str | None
    sanctions_gur: list[str] | None
    sanctions_new: list[str] | None


class FocusOut(BaseModel):
    """Customer focus tag of a ВПК company: drone, missile or kab, with its strongest basis."""

    focus: Literal["drone", "missile", "kab"]
    basis: str
    score: float | None
    evidence: dict | None


class EmployerAgencyOut(BaseModel):
    """Recruitment-agency decision for a page with no legal entity."""

    category: str | None
    level: str
    score: float | None
    raw_label: str


class EmployerOut(BaseModel):
    """An enterprise card: the profiles of one legal entity on job sites (branches apart).

    `id` is the card (the group's main profile); listed when it has a shown vacancy.
    """

    id: int
    name: str
    source: str
    inn: str | None
    ogrn: str | None
    kpp: str | None
    profile_url: str | None
    vpk_vacancies: int
    confirmed_vacancies: int
    # ВПК vacancies on review (`likely`) and vacancies placed as a recruitment agency.
    on_review_vacancies: int
    agency_vacancies: int
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
    # The latest human review; its values override the automatic ones above.
    human_review: EmployerReviewOut | None
    # Final classification of the legal entity; agency decision only for pages without one.
    classification: CompanyClassificationBriefOut | None = None
    agency: EmployerAgencyOut | None = None
    # Logo from the company's GUR card.
    logo_url: str | None = None
    # Job-site profiles merged into the card; a branch card of its legal entity.
    profiles: int = 1
    is_branch: bool = False
    # Focus tags of a ВПК company ([] = adjacent defence; None = not a ВПК company).
    focus: list[FocusOut] | None = None
    # A profile of the card has a questionable link to its legal entity (employer_match_conflict).
    match_conflict: bool = False


class MapPointOut(BaseModel):
    employer_id: int
    lat: float
    lng: float
    locality: str | None
    region_id: int | None
    vacancies: int


class MapRelationOut(BaseModel):
    company_id: int
    related_id: int
    kind: Literal["supplier", "parent"]
    company_name: str
    related_name: str
    source: str
    label: str | None
    evidence_url: str | None
    profile_url: str | None


class MapCompanyTagsOut(BaseModel):
    company_id: int
    uav: bool
    weapons: bool


class MapNetworkOut(BaseModel):
    relations: list[MapRelationOut]
    company_tags: list[MapCompanyTagsOut]


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


class HiringLocationOut(BaseModel):
    address: str | None
    locality: str | None
    lat: float | None
    lng: float | None
    source: str
    vacancy_id: int
    vacancy_url: str


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
    kpp: str | None
    address_uk: str | None
    description_uk: str | None
    products_uk: list[str] | None
    activity_tags: list[str]
    website: str | None
    logo_url: str | None
    gur_url: str | None
    sanctions_count: int
    sanctions_count_intl: int
    sanctions: list[SanctionOut]
    relations: list[RelationOut]
    # How the company was linked: by INN, by an automatic match, or by a probable name match.
    match: Literal["inn", "auto", "name"] = "inn"


class ProfileSourceOut(BaseModel):
    n: int
    url: str
    quote: str
    claim: str
    source_type: str
    grade: str


class CompanyProfileOut(BaseModel):
    """Profile assembled from open sources; every listed source has a verified quote."""

    company_id: int
    origin: str
    created_at: datetime
    # Start of the search run that produced the profile.
    updated_at: datetime
    activity_tags: list[str] | None
    products_ru: list[str] | None
    description_ru: str | None
    sources: list[ProfileSourceOut]


class SanctionFoundOut(BaseModel):
    jurisdiction: str
    list_name: str | None
    listed_raw: str | None
    in_gur: bool
    url: str | None


class CompanyClassificationOut(CompanyClassificationBriefOut):
    """Company-page version: with the sanctions found and the explanation."""

    sanctions_found: list[SanctionFoundOut]
    explanation: str


class CompanyContactOut(BaseModel):
    """Verified corporate requisite or contact; `url` is the page it was found on."""

    kind: Literal["inn", "ogrn", "legal_name", "website", "phone", "email", "head", "address"]
    value: str
    detail: str | None
    url: str | None


class CompanyRegistryOut(BaseModel):
    address: str | None
    head: str | None


class CardSourceOut(BaseModel):
    employer_profile_id: int
    source: str
    name: str
    url: str | None
    vacancies: int


class MatchConflictOut(BaseModel):
    """A questionable link of a profile to its legal entity, for a person to check."""

    employer_profile_id: int
    kind: Literal["different_inn", "peer_other_region"]
    evidence: dict | None


class EmployerDetailOut(EmployerOut):
    monthly: list[MonthPoint]
    professions: list[ProfessionOut]
    localities: list[LocalityOut]
    hiring_locations: list[HiringLocationOut]
    gur: GurCompanyOut | None
    # Legal entity behind the page; 'candidate' marks a probable link.
    company_id: int | None
    company_link: Literal["auto", "candidate"] | None
    classification: CompanyClassificationOut | None
    profile: CompanyProfileOut | None
    registry: CompanyRegistryOut | None
    contacts: list[CompanyContactOut]
    agency: EmployerAgencyOut | None
    human_reviews: list[EmployerReviewOut]
    # «Джерела вакансій»: the card's job-site profiles with their shown vacancies.
    sources: list[CardSourceOut]
    # A branch card: the card of its head office, if there is one.
    parent_card_id: int | None
    match_conflicts: list[MatchConflictOut]


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
    # Final label: `vpk` or `agency`; basis company_vpk, company_vpk_review, text_jev, legacy, …
    final_category: str
    final_basis: str
    # Explicit ВПК markers in the text (state secret, GOZ, military acceptance…).
    has_markers: bool


class EvidenceOut(BaseModel):
    signal: str
    origin: str
    weight: float | None
    snippet: str | None


class VacancyReviewIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    source: Literal["human", "llm"]
    confidence: Literal["high", "medium", "low"]
    reviewed_by: str = Field(min_length=2, max_length=120)
    comment: str | None = Field(default=None, max_length=2000)


class VacancyReviewOut(VacancyReviewIn):
    review_id: int
    vacancy_id: int
    reviewed_at: datetime


class VacancyDetailOut(VacancyOut):
    address: str | None
    description: str | None
    responsibilities: str | None
    requirements: str | None
    conditions: str | None
    skills_raw: str | None
    education: str | None
    final_level: str
    final_score: float | None
    # Counted and listed on the site (excluded vacancies stay reachable by a direct link).
    shown: bool
    evidence: list[EvidenceOut]
    classifier_name: str
    classifier_version: str | None
    reviews: list[VacancyReviewOut]


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


class BasisCount(BaseModel):
    category: str
    basis: str
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
    # Start of the final vacancy labelling run; None when it is missing (preliminary data).
    final_run_at: datetime | None
    vacancies: int
    vpk_vacancies: int
    confirmed_vacancies: int
    on_review_vacancies: int
    # Enterprise cards with ВПК vacancies; the job-site profiles and legal entities behind them.
    vpk_employers: int
    vpk_profiles: int
    vpk_legal_entities: int
    # ВПК vacancies with a monthly RUB salary (the median is over these).
    salary_samples: int
    regions: int
    median_salary: float | None
    gur_companies: int
    sanctioned_companies: int
    company_relations: int
    matched_employers: int
    # Legal entities by the final classification (latest run); agencies and intermediaries apart.
    vpk_companies: int
    vpk_companies_decided: int
    agency_vpk_companies: int
    foreign_intermediary_companies: int
    foreign_intermediary_decided: int
    # Employer pages of recruitment agencies hiring for the ВПК, and their vacancies; not part
    # of vpk_employers / vpk_vacancies.
    agency_employers: int
    agency_vacancies: int
    by_source: list[SourceCount]
    by_level: list[LevelCount]
    by_basis: list[BasisCount]
    by_category: list[CategoryCount]
    regions_list: list[RegionOut]
    monthly: list[MonthPoint]
