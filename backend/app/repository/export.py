"""Curated export datasets: SQL, field dictionary and streaming over the pipeline schema.

Each dataset is one flat table with stable ids, so files join with each other
(company_id, employer_id, vacancy_id). The column list is the field dictionary shown on the
site and in the API, and the order every format uses. SQL lives here, not in database views,
because the database belongs to the data pipeline and this service only reads it.

Every export is one of six variants (`Variant`): a coverage and a duplicates mode.
- coverage `site` (default): what the site shows — cards with a shown vacancy, their legal
  entities and shown vacancies; `vpk`: every legal entity classified ВПК (also those not hiring
  openly) plus `site`, with all active vacancies of their cards; `all`: the whole database,
  every company and every card with an active vacancy, with the labels to filter by.
- `dedup=True` (default): each vacancy and company once; `dedup=False` keeps reposts and
  cross-site copies (`duplicate_of`) and duplicate company rows (`canonical_id`).
All datasets of a variant are consistent: every company_id / employer_id they reference is in
the variant's `companies` / `employers` (relations may point outside, see `both_in_dataset`).
"""

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.db import engine
from app.repository.sql import (
    AS_OF,
    CLASSIFICATION_SELECT,
    EMPLOYER_SELECT,
    FINAL_RUN,
    FOCUS_SELECT,
    ON_GUR,
    vacancy_cte,
    with_human_review,
)
from app.repository.vacancies import VacancyFilter
from app.reviews import employer_reviews_ready

ColumnType = Literal["int", "float", "text", "bool", "date", "timestamp", "text[]"]
Coverage = Literal["site", "vpk", "all"]

# Full exports read whole tables; the default 20 s limit is meant for interactive pages.
EXPORT_TIMEOUT = "120s"

COVERAGES: dict[str, dict[str, str]] = {
    "site": {
        "title": "Як на сайті",
        "description": (
            "Те, що показано на сайті: картки підприємств із хоча б однією показаною вакансією "
            "(ВПК або кадрового агентства, що наймає у ВПК), їхні юрособи та показані вакансії."
        ),
    },
    "vpk": {
        "title": "Усі підприємства ВПК",
        "description": (
            "Усі юрособи, які ми класифікували як ВПК (зокрема ті, що зараз не мають відкритих "
            "вакансій, і ті, що на перевірці), разом з усіма активними вакансіями їхніх карток "
            "із підсумковою міткою."
        ),
    },
    "all": {
        "title": "Уся база",
        "description": (
            "Усе, що є в базі: всі компанії порталу ГУР (зокрема цивільні під санкціями та "
            "іноземні) і юрособи всіх роботодавців, яких ми перевіряли, всі картки з активними "
            "вакансіями та всі активні вакансії. Відбирайте потрібне за vpk_category і level."
        ),
    },
}


@dataclass(frozen=True)
class Variant:
    coverage: Coverage = "site"
    dedup: bool = True

    @property
    def slug(self) -> str:
        return self.coverage + ("" if self.dedup else "_raw")


SITE = Variant()  # the default variant: as on the site, without duplicates


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
    # What one row is, shown next to the row count.
    row: str
    key: tuple[str, ...]
    columns: tuple[Column, ...]
    # SQL for a variant; for filterable datasets with a `{where}` placeholder for the filter.
    sql: Callable[[Variant], str]
    filterable: bool = False

    def query(
        self, f: VacancyFilter | None = None, variant: Variant = SITE
    ) -> tuple[str, dict[str, Any]]:
        sql = self.sql(variant)
        if not self.filterable:
            return sql, {}
        f = replace(
            f or VacancyFilter(level="all", scope="all"), shown_only=variant.coverage == "site"
        )
        where, params = f.where()
        if variant.coverage == "vpk":  # shown ones, and every vacancy of a ВПК card
            where += " AND (v.final_level IN ('confirmed', 'likely')"
            where += " OR v.card_id IN (SELECT card_id FROM scope_cards))"
        return sql.replace("{where}", where), params


def _cols(*spec: tuple[str, ColumnType, str]) -> tuple[Column, ...]:
    return tuple(Column(*c) for c in spec)


def scope_cte(coverage: Coverage) -> str:
    """CTEs `scope_shown` (cards with a shown vacancy and their legal entity), `scope_cards`
    and `scope_companies` (canonical company ids) of a coverage."""
    cards = f"""
        SELECT DISTINCT coalesce(g.group_id, vac.employer_profile_id) AS card_id, g.company_id
        FROM vacancy_unique vac
        JOIN vacancy_classification vc ON vc.vacancy_id = vac.vacancy_id
        JOIN classifier_run r ON r.run_id = vc.run_id AND r.classifier = '{FINAL_RUN}'
        LEFT JOIN employer_group g ON g.employer_profile_id = vac.employer_profile_id
        WHERE vac.is_active AND vac.employer_profile_id IS NOT NULL
    """
    parts = [f"scope_shown AS ({cards} AND vc.level IN ('confirmed', 'likely'))"]
    shown_companies = "SELECT company_id FROM scope_shown WHERE company_id IS NOT NULL"
    if coverage == "site":
        parts += [
            f"scope_companies AS ({shown_companies})",
            "scope_cards AS (SELECT card_id FROM scope_shown)",
        ]
    elif coverage == "vpk":
        parts += [
            f"scope_active AS ({cards})",
            f"""scope_companies AS (
                SELECT company_id FROM ({CLASSIFICATION_SELECT}) c
                WHERE c.vpk_category IN ('vpk', 'agency_vpk')
                UNION {shown_companies})""",
            """scope_cards AS (
                SELECT card_id FROM scope_active
                WHERE company_id IN (SELECT company_id FROM scope_companies)
                UNION SELECT card_id FROM scope_shown)""",
        ]
    else:
        parts += [
            f"scope_active AS ({cards})",
            "scope_companies AS (SELECT company_id FROM company)",
            "scope_cards AS (SELECT card_id FROM scope_active)",
        ]
    return ",\n".join(parts)


def in_scope(column: str, variant: Variant) -> str:
    """The company in `column` belongs to the variant: its canonical row is in the coverage,
    and with dedup the row is not itself a duplicate."""
    canonical = (
        f"coalesce((SELECT d.canonical_id FROM company_duplicate d"
        f" WHERE d.company_id = {column}), {column})"
    )
    cond = f"{canonical} IN (SELECT company_id FROM scope_companies)"
    if variant.dedup:
        cond += f" AND {column} NOT IN (SELECT company_id FROM company_duplicate)"
    return cond


def _companies_sql(variant: Variant) -> str:
    return f"""
        WITH {scope_cte(variant.coverage)},
        cls AS ({CLASSIFICATION_SELECT}),
        foc AS (
            SELECT company_id, array_agg(focus ORDER BY focus) AS focus
            FROM ({FOCUS_SELECT}) f GROUP BY company_id
        ),
        cards AS (
            SELECT company_id, array_agg(DISTINCT card_id::text) AS card_ids
            FROM (SELECT g.company_id, g.group_id AS card_id FROM employer_group g
                  WHERE g.group_id IN (SELECT card_id FROM scope_cards)) x
            GROUP BY company_id
        )
        SELECT c.company_id, c.{ON_GUR} AS on_gur_portal, c.gur_id,
               c.name_full_uk AS name_uk, c.name_short_uk, c.name_full_ru AS name_ru,
               c.name_full_en AS name_en, c.inn, c.ogrn, c.kpp,
               co.name_uk AS country, co.iso2::text AS country_iso2,
               c.region, c.city, c.address_uk, c.website, c.description_uk, c.products_uk,
               c.status_raw, c.liquidated_on, c.sanctions_count::int, c.sanctions_count_intl::int,
               cls.vpk_category, cls.vpk_level, cls.vpk_probability::float8,
               cls.direction_label, cls.direction_domain, cls.direction_role, cls.reliability::text,
               foc.focus, cls.sanctions_gur, cls.sanctions_new,
               ARRAY(SELECT DISTINCT j FROM unnest(
                   coalesce(cls.sanctions_gur, ARRAY[]::text[])
                   || coalesce(cls.sanctions_new, ARRAY[]::text[])) j ORDER BY j) AS sanctions_all,
               coalesce(dup.canonical_id, c.company_id) IN (SELECT company_id FROM scope_shown)
                   AS on_site,
               cards.card_ids, dup.canonical_id::int AS canonical_id,
               c.updated_at
        FROM company c
        LEFT JOIN country co ON co.country_id = c.country_id
        LEFT JOIN company_duplicate dup ON dup.company_id = c.company_id
        LEFT JOIN cls ON cls.company_id = coalesce(dup.canonical_id, c.company_id)
        LEFT JOIN foc ON foc.company_id = coalesce(dup.canonical_id, c.company_id)
        LEFT JOIN cards ON cards.company_id = coalesce(dup.canonical_id, c.company_id)
        WHERE {in_scope("c.company_id", variant)}
        ORDER BY c.company_id
    """


COMPANIES = Dataset(
    name="companies",
    title="Підприємства",
    description=(
        "Юрособи: компанії з порталу ГУР «Війна та санкції» і юрособи роботодавців з реєстрів "
        "(ЄДРЮЛ), разом з нашою класифікацією. Ключ company_id використовується в усіх інших "
        "датасетах про компанії."
    ),
    row="одна юрособа",
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
        ("sanctions_count", "int", "Кількість юрисдикцій із санкціями за порталом ГУР (з UA)"),
        ("sanctions_count_intl", "int", "Те саме без України (як бейдж порталу ГУР)"),
        (
            "vpk_category",
            "text",
            "Дотичність до ВПК: vpk, agency_vpk (кадрове агентство, що наймає у ВПК), "
            "foreign_intermediary, foreign_other, civil_sanctioned, out (не ВПК), unknown",
        ),
        ("vpk_level", "text", "decided — рішення прийнято, review — на перевірці"),
        ("vpk_probability", "float", "Ймовірність категорії за моделлю (порожньо — за правилом)"),
        ("direction_label", "text", "Напрям діяльності, як на сайті"),
        ("direction_domain", "text", "Галузь: uav, missiles_space, aviation, civil_other…"),
        ("direction_role", "text", "Роль: manufacturer, component_supplier, rnd, repair…"),
        ("reliability", "text", "Надійність джерела за кодом Admiralty: A1…F6"),
        ("focus", "text[]", "Фокус замовника: drone, missile, kab; порожньо — суміжне"),
        ("sanctions_gur", "text[]", "Юрисдикції санкцій за порталом ГУР"),
        (
            "sanctions_new",
            "text[]",
            "Юрисдикції санкцій, знайдені додатково (OpenSanctions, пошук)",
        ),
        ("sanctions_all", "text[]", "Усі юрисдикції санкцій"),
        ("on_site", "bool", "Юрособа показана на сайті (є картка з показаною вакансією)"),
        ("card_ids", "text[]", "Картки підприємства в цьому наборі → employers.employer_id"),
        (
            "canonical_id",
            "int",
            "Лише в наборі з дублями: дубль цієї компанії → основний рядок companies.company_id",
        ),
        ("updated_at", "timestamp", "Останнє оновлення запису"),
    ),
    sql=_companies_sql,
)

COMPANY_SANCTIONS = Dataset(
    name="company_sanctions",
    title="Санкції",
    description="Санкційний статус компанії в кожній юрисдикції за порталом ГУР.",
    row="пара компанія — юрисдикція",
    key=("company_id", "jurisdiction"),
    columns=_cols(
        ("company_id", "int", "Компанія → companies.company_id"),
        ("jurisdiction", "text", "Код юрисдикції (US, UA, EU…)"),
        ("jurisdiction_name", "text", "Назва юрисдикції"),
        ("is_sanctioned", "bool", "Під санкціями в цій юрисдикції"),
        ("listed_on", "date", "Дата внесення до списку"),
        ("doc_url", "text", "Посилання на документ"),
    ),
    sql=lambda variant: (
        f"""
        WITH {scope_cte(variant.coverage)}
        SELECT s.company_id, s.jurisdiction, j.name_uk AS jurisdiction_name,
               s.is_sanctioned, s.listed_on, s.doc_url
        FROM company_sanction s
        LEFT JOIN sanction_jurisdiction j ON j.code = s.jurisdiction
        WHERE {in_scope("s.company_id", variant)}
        ORDER BY s.company_id, s.jurisdiction
    """
    ),
)

COMPANY_RELATIONS = Dataset(
    name="company_relations",
    title="Зв'язки між компаніями",
    description=(
        "Орієнтовані зв'язки: материнська компанія, банк, постачальник, правонаступник, філія. "
        "Хоча б один кінець — у цьому наборі; чи є в ньому обидва, показує both_in_dataset "
        "(холдинг підприємства часто сам не наймає і не потрапляє в набір «Як на сайті»)."
    ),
    row="зв'язок компанія → пов'язана компанія",
    key=("company_id", "related_id", "kind", "source"),
    columns=_cols(
        ("company_id", "int", "Компанія → companies.company_id"),
        ("company_name", "text", "Назва компанії"),
        ("related_id", "int", "Пов'язана компанія → companies.company_id"),
        ("related_name", "text", "Назва пов'язаної компанії"),
        ("kind", "text", "Тип зв'язку: parent, bank, related, successor, supplier, branch"),
        ("label", "text", "Уточнення зв'язку"),
        ("source", "text", "Джерело зв'язку"),
        ("evidence_url", "text", "Посилання на підтвердження"),
        ("both_in_dataset", "bool", "Обидві компанії є в companies цього набору"),
    ),
    sql=lambda variant: (
        f"""
        WITH {scope_cte(variant.coverage)},
        e AS (
            SELECT e.*, ({in_scope("e.company_id", variant)}) AS a_in,
                   ({in_scope("e.related_id", variant)}) AS b_in
            FROM company_edge e
        )
        SELECT e.company_id,
               coalesce(c.name_short_uk, c.name_full_uk, c.name_full_ru) AS company_name,
               e.related_id, coalesce(r.name_short_uk, r.name_full_uk, r.name_full_ru) AS related_name,
               e.kind, e.label, e.source, e.evidence_url, e.a_in AND e.b_in AS both_in_dataset
        FROM e
        JOIN company c ON c.company_id = e.company_id
        JOIN company r ON r.company_id = e.related_id
        WHERE e.a_in OR e.b_in
        ORDER BY e.company_id, e.related_id, e.kind, e.source
    """
    ),
)

COMPANY_PRODUCTS = Dataset(
    name="company_products",
    title="Зброя, БПЛА та компоненти",
    description=(
        "Зв'язок компаній зі зразками озброєння, моделями БПЛА та компонентами з порталу ГУР. "
        "product_type: weapon, uav, component."
    ),
    row="пара компанія — зразок",
    key=("company_id", "product_type", "product_id", "weapon_slug"),
    columns=_cols(
        ("company_id", "int", "Компанія → companies.company_id"),
        ("product_type", "text", "weapon — озброєння, uav — модель БПЛА, component — компонент"),
        ("product_id", "text", "Ідентифікатор зразка (slug озброєння, id БПЛА або компонента)"),
        ("product_name", "text", "Назва"),
        ("weapon_slug", "text", "Озброєння, до якого належить компонент"),
        ("url", "text", "Сторінка на порталі ГУР"),
    ),
    sql=lambda variant: (
        f"""
        WITH {scope_cte(variant.coverage)}
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
        WHERE {in_scope("t.company_id", variant)}
        ORDER BY company_id, product_type, product_id, weapon_slug
    """
    ),
)

COMPANY_SOURCES = Dataset(
    name="company_sources",
    title="Джерела про компанії",
    description="Посилання на джерела та архівні копії сторінок, з яких зібрано дані компанії.",
    row="одне посилання",
    key=("company_id", "kind", "position"),
    columns=_cols(
        ("company_id", "int", "Компанія → companies.company_id"),
        ("kind", "text", "source — джерело, archive — архівна копія"),
        ("position", "int", "Порядковий номер посилання"),
        ("url", "text", "Посилання"),
    ),
    sql=lambda variant: (
        f"""
        WITH {scope_cte(variant.coverage)}
        SELECT l.company_id, l.kind, l.position::int, l.url
        FROM company_link l
        WHERE {in_scope("l.company_id", variant)}
        ORDER BY l.company_id, l.kind, l.position
    """
    ),
)

# Same company link as the employer page: INN match with a GUR card, otherwise the best
# confident match (auto, or candidate >= 0.8), with duplicates resolved to the canonical row.
EMPLOYERS = Dataset(
    name="employers",
    title="Картки підприємств",
    description=(
        "Картки роботодавців, як на сайті: профілі одного юрлиця на різних сайтах вакансій "
        "склеєно в одну картку, філії — окремо. Агрегати за вакансіями та зв'язок з юрособою."
    ),
    row="одна картка (одне підприємство або філія)",
    key=("employer_id",),
    columns=_cols(
        ("employer_id", "int", "Картка → vacancies.employer_id, employer_profiles.card_id"),
        ("name", "text", "Назва на сайті вакансій"),
        ("source", "text", "Сайт вакансій головного профілю: hh, trudvsem, superjob"),
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
        (
            "profile_ids",
            "text[]",
            "Профілі картки на сайтах вакансій → employer_profiles.employer_profile_id",
        ),
        ("sanctions_count", "int", "Санкції компанії з порталу ГУР"),
        ("human_sources", "text[]", "Human review: джерела інформації (у CSV — через «; »)"),
        ("human_reliability", "text", "Human review: надійність джерела, шкала A–F"),
        ("human_category", "text", "Human review: напрям діяльності (замість category)"),
        ("human_sanctions", "text", "Human review: санкції — sanctioned, not_sanctioned"),
        ("human_vpk", "text", "Human review: дотичність до ВПК — confirmed, likely, no"),
        ("human_reviewed_by", "text", "Human review: хто перевірив (остання ревізія)"),
        ("human_reviewed_at", "timestamp", "Human review: коли перевірено"),
    ),
    sql=lambda variant: (
        f"""
        WITH {scope_cte(variant.coverage)}, e AS ({EMPLOYER_SELECT})
        SELECT e.id AS employer_id, e.name, e.source, e.profile_url, e.inn, e.ogrn, e.kpp,
               e.region, e.locality, e.category, e.vpk_vacancies::int, e.confirmed_vacancies::int,
               e.agency_vacancies::int,
               e.total_vacancies::int, e.new_30d::int, e.median_salary::float8, e.last_published_at,
               e.gur_company_id::int,
               coalesce(e.company_id, e.gur_company_id)::int AS matched_company_id,
               CASE WHEN e.profile_inn IS NOT NULL AND e.gur_company_id IS NOT NULL THEN 'inn'
                    WHEN e.company_id IS NULL THEN NULL
                    WHEN m.status IS NULL OR m.status = 'auto' THEN 'auto'
                    ELSE 'name' END AS match_method,
               e.profile_ids::text[] AS profile_ids,
               e.sanctions_count::int,
               e.human_sources, e.human_reliability, e.human_category, e.human_sanctions,
               e.human_vpk, e.human_reviewed_by, e.human_reviewed_at
        FROM e
        LEFT JOIN LATERAL (
            SELECT coalesce(d.canonical_id, cm.company_id) AS company_id, cm.status
            FROM employer_company_match cm
            LEFT JOIN company_duplicate d ON d.company_id = cm.company_id
            WHERE cm.employer_profile_id = ANY(e.profile_ids) AND cm.status <> 'rejected'
              AND coalesce(d.canonical_id, cm.company_id) = e.company_id
            ORDER BY cm.employer_profile_id = e.id DESC, cm.status = 'auto' DESC, cm.confidence DESC
            LIMIT 1
        ) m ON true
        WHERE e.id IN (SELECT card_id FROM scope_cards)
        ORDER BY e.id
    """
    ),
)

EMPLOYER_PROFILES = Dataset(
    name="employer_profiles",
    title="Профілі роботодавців",
    description=(
        "Профілі роботодавців на сайтах вакансій до склейки: кожен профіль і картка, до якої "
        "його віднесено. Так видно, які профілі hh.ru, «Работа России» і SuperJob ми вважаємо "
        "одним підприємством, і за яким збігом з юрособою."
    ),
    row="один профіль на одному сайті вакансій",
    key=("employer_profile_id",),
    columns=_cols(
        ("employer_profile_id", "int", "Профіль → vacancies.employer_profile_id"),
        ("source", "text", "Сайт вакансій: hh, trudvsem, superjob"),
        ("name", "text", "Назва на сайті вакансій"),
        ("url", "text", "Сторінка роботодавця"),
        ("card_id", "int", "Картка → employers.employer_id"),
        ("is_head", "bool", "Головний профіль картки (його id — id картки)"),
        ("is_branch", "bool", "Профіль філії"),
        ("company_id", "int", "Юрособа картки → companies.company_id"),
        (
            "match_status",
            "text",
            "Зв'язок профілю з юрособою: auto (за ІПН), candidate (за назвою, сайтом), verified",
        ),
        ("match_method", "text", "Як знайдено юрособу: inn, site_inn, egrul_name, name…"),
        ("match_confidence", "float", "Упевненість зв'язку, 0–1"),
    ),
    sql=lambda variant: (
        f"""
        WITH {scope_cte(variant.coverage)}
        SELECT ep.employer_profile_id, ep.source, ep.name, ep.url, g.group_id AS card_id,
               g.is_head, g.is_branch, g.company_id::int, m.status AS match_status,
               m.method AS match_method, round(m.confidence::numeric, 3)::float8 AS match_confidence
        FROM employer_group g
        JOIN employer_profile ep USING (employer_profile_id)
        LEFT JOIN LATERAL (
            SELECT cm.status, cm.method, cm.confidence
            FROM employer_company_match cm
            LEFT JOIN company_duplicate d ON d.company_id = cm.company_id
            WHERE cm.employer_profile_id = ep.employer_profile_id AND cm.status <> 'rejected'
              AND coalesce(d.canonical_id, cm.company_id) = g.company_id
            ORDER BY cm.status IN ('auto', 'verified') DESC, cm.confidence DESC NULLS LAST
            LIMIT 1
        ) m ON true
        WHERE g.group_id IN (SELECT card_id FROM scope_cards)
        ORDER BY ep.employer_profile_id
    """
    ),
)

VACANCIES = Dataset(
    name="vacancies",
    title="Вакансії",
    description=(
        "Активні вакансії з підсумковою міткою (запуск vacancy_final). "
        "Фільтри: scope, level, markers, region_id, category, title, q, days, employer_id."
    ),
    row="одна вакансія",
    key=("vacancy_id",),
    filterable=True,
    columns=_cols(
        ("vacancy_id", "int", "Ідентифікатор вакансії"),
        ("source", "text", "Сайт вакансій: hh, trudvsem, superjob"),
        ("url", "text", "Посилання на вакансію"),
        ("employer_id", "int", "Картка підприємства → employers.employer_id"),
        ("employer_profile_id", "int", "Профіль → employer_profiles.employer_profile_id"),
        ("employer_name", "text", "Назва роботодавця"),
        ("title", "text", "Назва посади"),
        (
            "final_category",
            "text",
            "Підсумкова мітка: vpk — підприємство ВПК, agency — кадрове агентство для ВПК, "
            "excluded — не показується (цивільна, іноземна компанія)",
        ),
        (
            "level",
            "text",
            "confirmed — показано, рішення прийнято; likely — показано, на перевірці; "
            "no — не показано",
        ),
        ("final_basis", "text", "Підстава: company_vpk, company_vpk_review, text_jev…"),
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
        (
            "duplicate_of",
            "int",
            "Лише в наборі з дублями: повтор цієї вакансії → основна vacancy_id "
            "(може бути вже неактивною); мітку повтор бере в основної",
        ),
        (
            "duplicate_method",
            "text",
            "repost_exact, repost_similar — повторна публікація на тому самому сайті; "
            "cross_source — та сама вакансія на іншому сайті",
        ),
        ("duplicate_score", "float", "Упевненість, що це дубль, 0–1"),
    ),
    sql=lambda variant: (
        f"""
        WITH {vacancy_cte(with_duplicates=not variant.dedup)}, {scope_cte(variant.coverage)}
        SELECT v.vacancy_id, v.source, v.url, v.card_id AS employer_id, v.employer_profile_id,
               v.employer_name, v.title, v.final_category, v.level, v.final_basis,
               v.has_markers, v.category, v.region_id, r.name AS region, v.locality,
               v.lat::float8, v.lng::float8, v.salary_from::float8, v.salary_to::float8,
               v.salary_currency, v.salary_period, v.monthly_salary::float8,
               v.experience, v.schedule, v.employment, v.published_at,
               v.duplicate_of::int, v.duplicate_method, v.duplicate_score::float8
        FROM v LEFT JOIN region r ON r.region_id = v.region_id
        WHERE {{where}}
        ORDER BY v.vacancy_id
    """
    ),
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
        EMPLOYER_PROFILES,
        VACANCIES,
    )
}

Row = dict[str, Any]


async def _begin(conn: AsyncConnection) -> None:
    await conn.execute(text(f"SET LOCAL statement_timeout = '{EXPORT_TIMEOUT}'"))


async def as_of(conn: AsyncConnection) -> datetime | None:
    return (await conn.execute(text(f"SELECT {AS_OF}"))).scalar_one()


async def stream_rows(
    dataset: Dataset, f: VacancyFilter | None = None, variant: Variant = SITE
) -> AsyncIterator[Row]:
    """Rows through a server-side cursor; owns its connection so it can outlive the request."""
    async with engine.connect() as conn, conn.begin():
        await _begin(conn)
        async for row in stream_in(conn, dataset, f, variant):
            yield row


async def _query(
    conn: AsyncConnection,
    dataset: Dataset,
    f: VacancyFilter | None = None,
    variant: Variant = SITE,
) -> tuple[str, dict[str, Any]]:
    sql, params = dataset.query(f, variant)
    return with_human_review(sql, await employer_reviews_ready(conn)), params


async def stream_in(
    conn: AsyncConnection,
    dataset: Dataset,
    f: VacancyFilter | None = None,
    variant: Variant = SITE,
) -> AsyncIterator[Row]:
    sql, params = await _query(conn, dataset, f, variant)
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


async def _count(conn: AsyncConnection, sql: str, params: dict[str, Any] | None = None) -> int:
    return (await conn.execute(text(f"SELECT count(*) FROM ({sql}) t"), params or {})).scalar_one()


async def catalog(variant: Variant = SITE) -> tuple[datetime | None, dict[str, int]]:
    """Snapshot date and the row count of every dataset of a variant (unfiltered)."""
    async with engine.connect() as conn, conn.begin():
        await _begin(conn)
        counts = {}
        for d in DATASETS.values():
            counts[d.name] = await _count(conn, *(await _query(conn, d, variant=variant)))
        return await as_of(conn), counts


async def overview() -> dict[str, Any]:
    """What each coverage holds and what deduplication removes, for the page's explanation."""
    async with engine.connect() as conn, conn.begin():
        await _begin(conn)
        coverages = {}
        for name in COVERAGES:
            v = Variant(coverage=name)  # type: ignore[arg-type]
            coverages[name] = {
                "companies": await _count(conn, *(await _query(conn, COMPANIES, variant=v))),
                "cards": await _count(conn, *(await _query(conn, EMPLOYERS, variant=v))),
                "vacancies": await _count(conn, *(await _query(conn, VACANCIES, variant=v))),
            }
        row = (
            (
                await conn.execute(
                    text(f"""
                WITH {scope_cte("site")}
                SELECT
                  (SELECT count(*) FROM vacancy WHERE is_active) AS vacancies_raw,
                  (SELECT count(*) FROM vacancy_unique WHERE is_active) AS vacancies_unique,
                  (SELECT count(*) FROM vacancy_duplicate d JOIN vacancy v USING (vacancy_id)
                   WHERE v.is_active AND d.method LIKE 'repost%') AS reposts,
                  (SELECT count(*) FROM vacancy_duplicate d JOIN vacancy v USING (vacancy_id)
                   WHERE v.is_active AND d.method = 'cross_source') AS cross_source,
                  (SELECT count(*) FROM employer_group
                   WHERE group_id IN (SELECT card_id FROM scope_cards)) AS site_profiles,
                  (SELECT count(DISTINCT card_id) FROM scope_cards) AS site_cards,
                  (SELECT count(*) FROM company_duplicate) AS company_duplicates,
                  (SELECT count(*) FROM company) AS companies_raw
            """)
                )
            )
            .mappings()
            .one()
        )
        return {"coverages": coverages, "dedup": dict(row)}


async def snapshot_date() -> datetime | None:
    async with engine.connect() as conn:
        return await as_of(conn)
