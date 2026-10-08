"""Curated export datasets: SQL, field dictionary and streaming over the pipeline schema.

Each dataset is one flat table with stable ids, so files join with each other
(company_id, employer_id, vacancy_id). The column list is the field dictionary shown on the
site and in the API, and the order every format uses. SQL lives here, not in database views,
because the database belongs to the data pipeline and this service only reads it.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.db import engine
from app.repository.sql import AS_OF, CTE, EMPLOYER_SELECT, LISTED, ON_GUR, with_human_review
from app.repository.vacancies import VacancyFilter
from app.reviews import employer_reviews_ready

ColumnType = Literal["int", "float", "text", "bool", "date", "timestamp", "text[]"]

# Full exports read whole tables; the default 20 s limit is meant for interactive pages.
EXPORT_TIMEOUT = "120s"


@dataclass(frozen=True)
class Column:
    name: str
    type: ColumnType
    description: str


@dataclass(frozen=True)
class Dataset:
    name: str
    title: str
    description: str
    key: tuple[str, ...]
    columns: tuple[Column, ...]
    # `{where}` is replaced by VacancyFilter conditions for filterable datasets.
    sql: str
    filterable: bool = False

    def query(self, f: VacancyFilter | None = None) -> tuple[str, dict[str, Any]]:
        if not self.filterable:
            return self.sql, {}
        where, params = (f or VacancyFilter(level="all", scope="all")).where()
        return self.sql.replace("{where}", where), params


def _cols(*spec: tuple[str, ColumnType, str]) -> tuple[Column, ...]:
    return tuple(Column(*c) for c in spec)


COMPANIES = Dataset(
    name="companies",
    title="Підприємства",
    description=(
        "Компанії з порталу ГУР «Війна та санкції» та з реєстрів (ЄДРЮЛ). "
        "Ключ company_id використовується в усіх інших датасетах про компанії."
    ),
    key=("company_id",),
    columns=_cols(
        ("company_id", "int", "Ідентифікатор компанії"),
        ("on_gur_portal", "bool", "Є картка на порталі ГУР (інакше лише реєстрові дані)"),
        ("gur_id", "int", "Ідентифікатор на порталі ГУР"),
        ("name_uk", "text", "Повна назва українською"),
        ("name_short_uk", "text", "Коротка назва українською"),
        ("name_ru", "text", "Повна назва російською"),
        ("name_en", "text", "Повна назва англійською"),
        ("inn", "text", "ІПН (ИНН)"),
        ("ogrn", "text", "ОГРН"),
        ("kpp", "text", "КПП"),
        ("country", "text", "Країна"),
        ("country_iso2", "text", "Код країни ISO 3166-1 alpha-2"),
        ("region", "text", "Регіон за адресою"),
        ("city", "text", "Місто"),
        ("address_uk", "text", "Адреса українською"),
        ("website", "text", "Сайт"),
        ("description_uk", "text", "Опис діяльності українською"),
        ("products_uk", "text[]", "Продукція (у CSV — через «; »)"),
        ("status_raw", "text", "Статус юрособи, як у джерелі"),
        ("liquidated_on", "date", "Дата ліквідації"),
        ("sanctions_count", "int", "Кількість юрисдикцій, що запровадили санкції"),
        ("sanctions_count_intl", "int", "Кількість міжнародних санкційних юрисдикцій"),
        ("updated_at", "timestamp", "Останнє оновлення запису"),
    ),
    sql=f"""
        SELECT c.company_id, c.{ON_GUR} AS on_gur_portal, c.gur_id,
               c.name_full_uk AS name_uk, c.name_short_uk, c.name_full_ru AS name_ru,
               c.name_full_en AS name_en, c.inn, c.ogrn, c.kpp,
               co.name_uk AS country, co.iso2::text AS country_iso2,
               c.region, c.city, c.address_uk, c.website, c.description_uk, c.products_uk,
               c.status_raw, c.liquidated_on, c.sanctions_count::int, c.sanctions_count_intl::int,
               c.updated_at
        FROM company c
        LEFT JOIN country co ON co.country_id = c.country_id
        ORDER BY c.company_id
    """,
)

COMPANY_SANCTIONS = Dataset(
    name="company_sanctions",
    title="Санкції",
    description="Санкційний статус компанії в кожній юрисдикції (рядок на пару компанія–юрисдикція).",
    key=("company_id", "jurisdiction"),
    columns=_cols(
        ("company_id", "int", "Компанія → companies.company_id"),
        ("jurisdiction", "text", "Код юрисдикції (US, UA, EU…)"),
        ("jurisdiction_name", "text", "Назва юрисдикції"),
        ("is_sanctioned", "bool", "Під санкціями в цій юрисдикції"),
        ("listed_on", "date", "Дата внесення до списку"),
        ("doc_url", "text", "Посилання на документ"),
    ),
    sql="""
        SELECT s.company_id, s.jurisdiction, j.name_uk AS jurisdiction_name,
               s.is_sanctioned, s.listed_on, s.doc_url
        FROM company_sanction s
        LEFT JOIN sanction_jurisdiction j ON j.code = s.jurisdiction
        ORDER BY s.company_id, s.jurisdiction
    """,
)

COMPANY_RELATIONS = Dataset(
    name="company_relations",
    title="Зв'язки між компаніями",
    description=(
        "Орієнтовані зв'язки: материнська компанія, банк, постачальник, правонаступник тощо. "
        "Обидва кінці — companies.company_id."
    ),
    key=("company_id", "related_id", "kind", "source"),
    columns=_cols(
        ("company_id", "int", "Компанія → companies.company_id"),
        ("company_name", "text", "Назва компанії"),
        ("related_id", "int", "Пов'язана компанія → companies.company_id"),
        ("related_name", "text", "Назва пов'язаної компанії"),
        ("kind", "text", "Тип зв'язку: parent, bank, related, successor, supplier"),
        ("label", "text", "Уточнення зв'язку"),
        ("source", "text", "Джерело зв'язку"),
        ("evidence_url", "text", "Посилання на підтвердження"),
    ),
    sql="""
        SELECT e.company_id, coalesce(c.name_short_uk, c.name_full_uk, c.name_full_ru) AS company_name,
               e.related_id, coalesce(r.name_short_uk, r.name_full_uk, r.name_full_ru) AS related_name,
               e.kind, e.label, e.source, e.evidence_url
        FROM company_edge e
        JOIN company c ON c.company_id = e.company_id
        JOIN company r ON r.company_id = e.related_id
        ORDER BY e.company_id, e.related_id, e.kind, e.source
    """,
)

COMPANY_PRODUCTS = Dataset(
    name="company_products",
    title="Зброя, БПЛА та компоненти",
    description=(
        "Зв'язок компаній зі зразками озброєння, моделями БПЛА та компонентами з порталу ГУР. "
        "product_type: weapon, uav, component."
    ),
    key=("company_id", "product_type", "product_id", "weapon_slug"),
    columns=_cols(
        ("company_id", "int", "Компанія → companies.company_id"),
        ("product_type", "text", "weapon — озброєння, uav — модель БПЛА, component — компонент"),
        ("product_id", "text", "Ідентифікатор зразка (slug озброєння, id БПЛА або компонента)"),
        ("product_name", "text", "Назва"),
        ("weapon_slug", "text", "Озброєння, до якого належить компонент"),
        ("url", "text", "Сторінка на порталі ГУР"),
    ),
    sql="""
        SELECT * FROM (
            SELECT cw.company_id, 'weapon' AS product_type, w.weapon_slug AS product_id,
                   coalesce(w.name_uk, w.name_en, w.name_ru) AS product_name,
                   w.weapon_slug, w.url
            FROM company_weapon cw JOIN weapon w USING (weapon_slug)
            UNION ALL
            SELECT cu.company_id, 'uav', u.uav_model_id::text,
                   coalesce(u.name_uk, u.name_en, u.name_ru), NULL, u.url_uk
            FROM company_uav_model cu JOIN uav_model u USING (uav_model_id)
            UNION ALL
            SELECT cc.company_id, 'component', p.part_id::text,
                   coalesce(p.name_uk, p.name_en, p.name_ru), cc.weapon_slug, p.url
            FROM company_weapon_component cc JOIN component p USING (part_id)
        ) t
        ORDER BY company_id, product_type, product_id, weapon_slug
    """,
)

COMPANY_SOURCES = Dataset(
    name="company_sources",
    title="Джерела про компанії",
    description="Посилання на джерела та архівні копії сторінок, з яких зібрано дані компанії.",
    key=("company_id", "kind", "position"),
    columns=_cols(
        ("company_id", "int", "Компанія → companies.company_id"),
        ("kind", "text", "source — джерело, archive — архівна копія"),
        ("position", "int", "Порядковий номер посилання"),
        ("url", "text", "Посилання"),
    ),
    sql="""
        SELECT company_id, kind, position::int, url
        FROM company_link
        ORDER BY company_id, kind, position
    """,
)

# Same company link as the employer page: INN match with a GUR card, otherwise the best
# confident match (auto, or candidate >= 0.8), with duplicates resolved to the canonical row.
EMPLOYERS = Dataset(
    name="employers",
    title="Роботодавці ВПК",
    description=(
        "Роботодавці з сайтів вакансій (hh.ru, «Работа России») з хоча б однією активною "
        "вакансією ВПК або кадрового агентства, що наймає у ВПК, з агрегатами за вакансіями "
        "та зв'язком з компанією."
    ),
    key=("employer_id",),
    columns=_cols(
        ("employer_id", "int", "Роботодавець → vacancies.employer_id"),
        ("name", "text", "Назва на сайті вакансій"),
        ("source", "text", "Сайт вакансій: hh, trudvsem"),
        ("profile_url", "text", "Сторінка роботодавця"),
        ("inn", "text", "ІПН (ИНН)"),
        ("ogrn", "text", "ОГРН"),
        ("kpp", "text", "КПП"),
        ("region", "text", "Найчастіший регіон вакансій"),
        ("locality", "text", "Найчастіший населений пункт вакансій"),
        ("category", "text", "Найчастіший напрям вакансій ВПК"),
        ("vpk_vacancies", "int", "Активні вакансії ВПК (confirmed + likely)"),
        ("confirmed_vacancies", "int", "Активні вакансії ВПК з рівнем confirmed"),
        ("agency_vacancies", "int", "Активні вакансії, розміщені як кадрове агентство для ВПК"),
        ("total_vacancies", "int", "Усі активні вакансії"),
        ("new_30d", "int", "Нові вакансії ВПК за 30 днів до дати зрізу"),
        ("median_salary", "float", "Медіана місячної зарплати вакансій ВПК, RUB"),
        ("last_published_at", "timestamp", "Остання публікація вакансії"),
        ("gur_company_id", "int", "Компанія на порталі ГУР за ІПН → companies.company_id"),
        ("matched_company_id", "int", "Найкращий збіг з компанією → companies.company_id"),
        ("match_method", "text", "Спосіб збігу: inn, auto, name"),
        ("sanctions_count", "int", "Санкції компанії з порталу ГУР"),
        ("human_sources", "text[]", "Human review: джерела інформації (у CSV — через «; »)"),
        ("human_reliability", "text", "Human review: надійність джерела, шкала A–F"),
        ("human_category", "text", "Human review: напрям діяльності (замість category)"),
        ("human_sanctions", "text", "Human review: санкції — sanctioned, not_sanctioned"),
        ("human_vpk", "text", "Human review: дотичність до ВПК — confirmed, likely, no"),
        ("human_reviewed_by", "text", "Human review: хто перевірив (остання ревізія)"),
        ("human_reviewed_at", "timestamp", "Human review: коли перевірено"),
    ),
    sql=f"""
        WITH e AS ({EMPLOYER_SELECT} WHERE {LISTED})
        SELECT e.id AS employer_id, e.name, e.source, e.profile_url, e.inn, e.ogrn, e.kpp,
               e.region, e.locality, e.category, e.vpk_vacancies::int, e.confirmed_vacancies::int,
               e.agency_vacancies::int,
               e.total_vacancies::int, e.new_30d::int, e.median_salary::float8, e.last_published_at,
               e.gur_company_id::int,
               coalesce(e.gur_company_id, m.company_id)::int AS matched_company_id,
               CASE WHEN e.gur_company_id IS NOT NULL THEN 'inn'
                    WHEN m.status = 'auto' THEN 'auto'
                    WHEN m.company_id IS NOT NULL THEN 'name' END AS match_method,
               e.sanctions_count::int,
               e.human_sources, e.human_reliability, e.human_category, e.human_sanctions,
               e.human_vpk, e.human_reviewed_by, e.human_reviewed_at
        FROM e
        LEFT JOIN LATERAL (
            SELECT coalesce(d.canonical_id, cm.company_id) AS company_id, cm.status
            FROM employer_company_match cm
            LEFT JOIN company_duplicate d ON d.company_id = cm.company_id
            WHERE cm.employer_profile_id = e.id
              AND (cm.status = 'auto' OR (cm.status = 'candidate' AND cm.confidence >= 0.8))
            ORDER BY cm.status = 'auto' DESC, cm.confidence DESC, 1
            LIMIT 1
        ) m ON true
        ORDER BY e.id
    """,
)

VACANCIES = Dataset(
    name="vacancies",
    title="Вакансії",
    description=(
        "Активні вакансії, показані на сайті: підсумкова мітка (запуск vacancy_final) — "
        "вакансії підприємств ВПК і кадрових агентств, що наймають у ВПК; без дублів. "
        "Фільтри: scope, level, markers, region_id, category, title, q, days, employer_id."
    ),
    key=("vacancy_id",),
    filterable=True,
    columns=_cols(
        ("vacancy_id", "int", "Ідентифікатор вакансії"),
        ("source", "text", "Сайт вакансій: hh, trudvsem"),
        ("url", "text", "Посилання на вакансію"),
        ("employer_id", "int", "Роботодавець → employers.employer_id"),
        ("employer_name", "text", "Назва роботодавця"),
        ("title", "text", "Назва посади"),
        (
            "final_category",
            "text",
            "Підсумкова мітка: vpk — підприємство ВПК, agency — кадрове агентство",
        ),
        ("level", "text", "Рішення: confirmed — прийнято, likely — на перевірці"),
        ("final_basis", "text", "Підстава: company_vpk, company_vpk_review, text_jev"),
        (
            "has_markers",
            "bool",
            "Явні ознаки ВПК у тексті (держтаємниця, ДОЗ, військове приймання…)",
        ),
        ("category", "text", "Напрям (виробництво, НДІ/КБ тощо)"),
        ("region_id", "int", "Ідентифікатор регіону"),
        ("region", "text", "Регіон (для hh.ru — за містом)"),
        ("locality", "text", "Населений пункт"),
        ("lat", "float", "Широта місця роботи"),
        ("lng", "float", "Довгота місця роботи"),
        ("salary_from", "float", "Зарплата від"),
        ("salary_to", "float", "Зарплата до"),
        ("salary_currency", "text", "Валюта"),
        ("salary_period", "text", "Період зарплати"),
        ("monthly_salary", "float", "Місячна зарплата в RUB (середина діапазону)"),
        ("experience", "text", "Досвід"),
        ("schedule", "text", "Графік"),
        ("employment", "text", "Зайнятість"),
        ("published_at", "timestamp", "Дата публікації"),
    ),
    sql=f"""
        WITH {CTE}
        SELECT v.vacancy_id, v.source, v.url, v.employer_profile_id AS employer_id, v.employer_name,
               v.title, v.final_category, v.level, v.final_basis, v.has_markers, v.category, v.region_id, r.name AS region, v.locality,
               v.lat::float8, v.lng::float8, v.salary_from::float8, v.salary_to::float8,
               v.salary_currency, v.salary_period, v.monthly_salary::float8,
               v.experience, v.schedule, v.employment, v.published_at
        FROM v LEFT JOIN region r ON r.region_id = v.region_id
        WHERE {{where}}
        ORDER BY v.vacancy_id
    """,
)

DATASETS: dict[str, Dataset] = {
    d.name: d
    for d in (
        COMPANIES,
        COMPANY_SANCTIONS,
        COMPANY_RELATIONS,
        COMPANY_PRODUCTS,
        COMPANY_SOURCES,
        EMPLOYERS,
        VACANCIES,
    )
}

Row = dict[str, Any]


async def _begin(conn: AsyncConnection) -> None:
    await conn.execute(text(f"SET LOCAL statement_timeout = '{EXPORT_TIMEOUT}'"))


async def as_of(conn: AsyncConnection) -> datetime | None:
    return (await conn.execute(text(f"SELECT {AS_OF}"))).scalar_one()


async def stream_rows(dataset: Dataset, f: VacancyFilter | None = None) -> AsyncIterator[Row]:
    """Rows through a server-side cursor; owns its connection so it can outlive the request."""
    async with engine.connect() as conn, conn.begin():
        await _begin(conn)
        async for row in stream_in(conn, dataset, f):
            yield row


async def _query(
    conn: AsyncConnection, dataset: Dataset, f: VacancyFilter | None = None
) -> tuple[str, dict[str, Any]]:
    sql, params = dataset.query(f)
    return with_human_review(sql, await employer_reviews_ready(conn)), params


async def stream_in(
    conn: AsyncConnection, dataset: Dataset, f: VacancyFilter | None = None
) -> AsyncIterator[Row]:
    sql, params = await _query(conn, dataset, f)
    result = await conn.stream(text(sql), params)
    async for row in result.mappings():
        yield dict(row)


@asynccontextmanager
async def snapshot_connection() -> AsyncIterator[AsyncConnection]:
    """One repeatable-read transaction, so every dataset of a snapshot sees the same data."""
    async with engine.connect() as conn:
        conn = await conn.execution_options(isolation_level="REPEATABLE READ")
        async with conn.begin():
            await _begin(conn)
            yield conn


async def catalog() -> tuple[datetime | None, dict[str, int]]:
    """Snapshot date and the row count of every dataset (unfiltered)."""
    async with engine.connect() as conn, conn.begin():
        await _begin(conn)
        counts = {}
        for d in DATASETS.values():
            sql, params = await _query(conn, d)
            counts[d.name] = (
                await conn.execute(text(f"SELECT count(*) FROM ({sql}) t"), params)
            ).scalar_one()
        return await as_of(conn), counts


async def snapshot_date() -> datetime | None:
    async with engine.connect() as conn:
        return await as_of(conn)
