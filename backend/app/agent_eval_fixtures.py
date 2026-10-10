"""Explicitly synthetic evaluation data. Never connects to a database."""

from copy import deepcopy
from datetime import UTC, datetime

AS_OF = datetime(2026, 10, 9, tzinfo=UTC)
REGIONS = {
    1: "Москва",
    2: "Санкт-Петербург",
    3: "Казань",
    4: "Іжевськ",
    5: "Набережні Челни",
    6: "Єлабуга",
}


def card(ident, name, region, salary, count, products, *, coordinates=True):
    return {
        "id": ident,
        "name": name,
        "source": "hh",
        "inn": str(1000000000 + ident),
        "ogrn": None,
        "kpp": None,
        "profile_url": None,
        "vpk_vacancies": count,
        "confirmed_vacancies": count,
        "on_review_vacancies": 0,
        "agency_vacancies": 0,
        "total_vacancies": count,
        "new_30d": count,
        "median_salary": salary,
        "category": "производство",
        "locality": REGIONS[region],
        "region_id": region,
        "region": REGIONS[region],
        "last_published_at": AS_OF,
        "gur_company_id": ident,
        "gur_name": name,
        "sanctions_count": 1 if ident == 41 else 0,
        "human_review": None,
        "classification": None,
        "_products": products,
        "_coordinates": coordinates,
    }


CARDS = [
    card(41, "Калашников", 4, 79000, 387, ["стрілецька зброя", "верстати"]),
    card(42, "КамАЗ", 5, 91000, 210, ["вантажні автомобілі", "дизельні двигуни"]),
    card(43, "Роскосмос", 1, None, 8, []),
    card(44, "Алабуга", 6, 100000, 170, ["промислові послуги"]),
    card(45, "Орбіта", 1, 90000, 2, ["електронні компоненти"], coordinates=False),
    card(46, "Омега Москва", 1, 85000, 3, ["насоси"]),
    card(47, "Омега Петербург", 2, 80000, 4, ["клапани"]),
]
for region in (1, 2, 3):
    for rank in range(5):
        CARDS.append(
            card(
                100 + (region - 1) * 5 + rank,
                f"Тестмаш {region}-{rank + 1}",
                region,
                140000 - rank * 10000,
                51 - rank * 10,
                ["промислові двигуни", "машинні деталі"],
            )
        )


def directory():
    return [{k: v for k, v in row.items() if not k.startswith("_")} for row in deepcopy(CARDS)]


def profile(ident):
    row = next((deepcopy(c) for c in CARDS if c["id"] == ident), None)
    if not row:
        return None
    products = row.pop("_products")
    coordinates = row.pop("_coordinates")
    description = (
        "Держкорпорація координує роботу організацій космічної галузі. "
        "Власна продукція та продукція дочірніх підприємств не перелічені."
        if ident == 43
        else "Продукція: " + "; ".join(products) + "."
    )
    relations = (
        []
        if ident != 42
        else [
            {
                "kind": "supplier",
                "direction": "out",
                "company_id": 100,
                "name": "Тестмаш 1-1",
                "inn": "1000000100",
                "sanctions_count": 0,
                "employer_id": 100,
            }
        ]
    )
    row.update(
        {k: None for k in ("company_link", "profile", "registry", "agency", "parent_card_id")}
    )
    row.update(
        {
            k: []
            for k in (
                "monthly",
                "professions",
                "localities",
                "hiring_locations",
                "contacts",
                "human_reviews",
                "sources",
                "match_conflicts",
            )
        }
    )
    row.update(
        company_id=ident,
        sites=[
            {
                "kind": "head_office",
                "name": row["name"],
                "address": "ТЕСТОВА АДРЕСА",
                "lat": 55.75,
                "lng": 37.61,
                "geo_qc": 0,
                "on_map": True,
            }
        ]
        if coordinates
        else [],
    )
    row["gur"] = {
        "company_id": ident,
        "name": row["name"],
        "name_full_uk": row["name"],
        "name_full_ru": None,
        "inn": row["inn"],
        "ogrn": None,
        "kpp": None,
        "address_uk": "ТЕСТОВА АДРЕСА",
        "description_uk": description,
        "products_uk": products,
        "activity_tags": [],
        "website": None,
        "logo_url": None,
        "gur_url": f"https://example.com/fixture/company/{ident}",
        "sanctions_count": row["sanctions_count"],
        "sanctions_count_intl": row["sanctions_count"],
        "sanctions": [{"jurisdiction": "EU", "jurisdiction_name": "ЄС", "listed_on": None}]
        if ident == 41
        else [],
        "relations": relations,
    }
    return row


def selection(filters, employer_ids=None):
    rows = directory()
    if filters.employer_ids is not None:
        rows = [c for c in rows if c["id"] in filters.employer_ids]
    if filters.employer_id:
        rows = [c for c in rows if c["id"] == filters.employer_id]
    if employer_ids:
        rows = [c for c in rows if c["id"] in employer_ids]
    if filters.region_id:
        rows = [c for c in rows if c["region_id"] == filters.region_id]
    if filters.category:
        rows = [c for c in rows if c["category"] == filters.category]
    return rows


async def analytics(
    session, filters, group_by, metric, query="", employer_ids=None, limit=10, only_sanctioned=False
):
    selected = selection(filters, employer_ids)
    if query:
        selected = [c for c in selected if query.lower() in c["name"].lower()]
    if only_sanctioned:
        selected = [c for c in selected if c["sanctions_count"]]
    groups = {}
    for company in selected:
        ident, label = {
            "company": (company["id"], company["name"]),
            "region": (company["region_id"], company["region"]),
            "category": (1, company["category"]),
            "summary": (1, "Уся вибірка"),
            "month": ("2026-10-01", "2026-10-01"),
        }[group_by]
        groups.setdefault((ident, label), []).append(company)
    rows = []
    for (ident, label), companies in groups.items():
        salaries = sorted(c["median_salary"] for c in companies if c["median_salary"] is not None)
        if metric == "median_salary" and not salaries:
            continue
        value = sum(c["total_vacancies"] for c in companies)
        if metric == "median_salary":
            middle = len(salaries) // 2
            value = (salaries[middle] + salaries[(len(salaries) - 1) // 2]) / 2
        rows.append(
            {
                "id": ident,
                "label": label,
                "value": value,
                "vacancies": sum(c["total_vacancies"] for c in companies),
                "salary_samples": len(salaries),
                "confirmed_vacancies": value,
                "sanctions_count": max(c["sanctions_count"] for c in companies),
                "employers": len(companies),
            }
        )
    rows.sort(key=lambda row: (-row["value"], row["label"]))
    return {"rows": rows[:limit], "as_of": AS_OF}


async def summary(session, filters):
    rows = selection(filters)
    return {
        "employers": len(rows),
        "vacancies": sum(c["total_vacancies"] for c in rows),
        "salary_samples": len([c for c in rows if c["median_salary"]]),
        "median_salary": None,
        "as_of": AS_OF,
    }


class FixtureSession:
    """Allows only the scalar snapshot SELECT used by the real agent."""

    writes = 0

    async def execute(self, sql, *args, **kwargs):
        if not str(sql).lstrip().upper().startswith("SELECT"):
            self.writes += 1
            raise RuntimeError("Evaluation forbids writes")
        return self

    def scalar_one(self):
        return AS_OF
