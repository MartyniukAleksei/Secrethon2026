"""Build a versioned, inspectable 200-case behavioral evaluation dataset."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agent_eval_fixtures import CARDS  # noqa: E402

TARGET = Path(__file__).resolve().parents[1] / "evals/agent_scenarios.jsonl"


def build():
    cases = []

    def add(
        family,
        question,
        index,
        expect,
        *,
        context=None,
        history=None,
        web_access="ask",
        approved_context=None,
        fixture_variant=None,
    ):
        cases.append(
            {
                "id": f"{family}-{index + 1:02d}",
                "version": 1,
                "split": "heldout" if index >= 8 else "development",
                "family": family,
                "data_mode": "synthetic_fixture",
                "request": {
                    "message": question,
                    "context": context
                    or {"page": "map", "company_id": 44, "days": 0, "category": "производство"},
                    "history": history or [],
                    "web_access": web_access,
                    "approved_context": approved_context or [],
                },
                "fixture_variant": fixture_variant or {},
                "expect": {"no_writes": True, **expect},
            }
        )

    for n in range(10):
        ident, name, keywords = [
            (41, "Калашников", ["збро", "верстат"]),
            (42, "КамАЗ", ["вантаж", "двигун"]),
        ][n % 2]
        suffix = [
            "",
            " Коротко.",
            " Дай конкретний перелік.",
            " З джерелами.",
            " Без загальних фраз.",
            " Зараз дивлюсь Алабугу.",
            " Покажи на карті.",
            " Українською.",
            " Перелічи види продукції.",
            " Поясни простими словами.",
        ][n]
        add(
            "products",
            f"Що виробляє {name}?{suffix}",
            n,
            {
                "map": {"kind": "focus_company", "employer_id": ident},
                "cite": True,
                "text_all": keywords,
                "profile_ids": [ident],
            },
        )
        add(
            "missing_products",
            "Що саме виробляє Роскосмос?" + suffix,
            n,
            {
                "profile_ids": [43],
                "permission": True,
                "map": {"kind": "focus_company", "employer_id": 43},
            },
        )
        region, city = [(1, "Москві"), (2, "Санкт-Петербурзі"), (3, "Казані")][n % 3]
        limit = [5, 3, 2, 4, 5, 2, 3, 4, 5, 3][n]
        expected_ids = [100 + (region - 1) * 5 + i for i in range(limit)]
        add(
            "salary_city",
            f"Топ {limit} найкращих по зарплаті компаній у {city}. За весь період." + suffix,
            n,
            {
                "analytics": {
                    "group_by": "company",
                    "metric": "median_salary",
                    "region_id": region,
                    "limit": limit,
                    "global": True,
                },
                "table_ids": expected_ids,
                "table_values": [140000 - i * 10000 for i in range(limit)],
                "cite": True,
            },
        )
        top = sorted(CARDS, key=lambda c: (-c["total_vacancies"], c["name"]))[:limit]
        add(
            "global_vacancies",
            f"Топ {limit} компаній за кількістю вакансій по всій базі." + suffix,
            n,
            {
                "analytics": {
                    "group_by": "company",
                    "metric": "vacancies",
                    "limit": limit,
                    "global": True,
                },
                "table_ids": [c["id"] for c in top],
                "cite": True,
            },
        )
        add(
            "industry_ranking",
            f"Топ {limit} компаній по виробництву ракет." + suffix,
            n,
            {
                "clarify": True,
                "text_any": ["критері", "ранж", "обсяг"],
                "no_map": True,
                "no_analytics": True,
            },
        )
        add(
            "relations",
            "Зв'язки КамАЗ." + suffix,
            n,
            {
                "map": {"kind": "show_relations", "employer_id": 42},
                "profile_ids": [42],
                "relation_id": 100,
                "cite": True,
            },
        )
        add(
            "explicit_map",
            f"Знайди {name} та наблизь його головний офіс на карті." + suffix,
            n,
            {"map": {"kind": "focus_company", "employer_id": ident}, "profile_ids": [ident]},
        )
        add(
            "comparison",
            "Порівняй продукцію Калашникова і КамАЗ." + suffix,
            n,
            {"profile_ids": [41, 42], "text_all": ["збро", "вантаж"], "no_map": True, "cite": True},
        )
        add(
            "web_permission",
            f"Перевір у вебджерелах свіжі новини про {name}." + suffix,
            n,
            {"permission": True, "profile_ids": [ident], "web_calls": 0},
        )
        add(
            "web_declined",
            f"Які останні новини про {name}? Тільки з бази, без інтернету." + suffix,
            n,
            {"permission": False, "web_calls": 0, "no_public_web": True},
            web_access="db_only",
        )
        add(
            "web_allowed",
            f"Знайди свіжі згадки про {name} в інтернеті." + suffix,
            n,
            {"permission": False, "web_calls_min": 1, "web_unverified": True, "cite": True},
            web_access="allowed",
        )
        add(
            "sanctions",
            "Чи є санкції проти Калашникова?" + suffix,
            n,
            {"profile_ids": [41], "text_any": ["санкц", "єс"], "cite": True},
        )
        add(
            "followup",
            "А що він виробляє?" + suffix,
            n,
            {"profile_ids": [42], "text_all": ["вантаж", "двигун"], "cite": True},
            context={"page": "map", "company_id": 42, "days": 0},
            history=[
                {"role": "user", "text": "Розкажи про КамАЗ"},
                {"role": "assistant", "text": "Відкрито профіль КамАЗ."},
            ],
        )
        add(
            "ambiguous_name",
            "Що виробляє Омега?" + suffix,
            n,
            {"clarify": True, "no_map": True, "text_any": ["уточн", "яку", "дві", "два"]},
        )
        add(
            "unknown_company",
            "Що виробляє Несуществующаяфирма999?" + suffix,
            n,
            {"no_map": True, "text_any": ["не знай", "нема", "уточн", "відсут"]},
        )
        add(
            "missing_coordinates",
            "Наблизь Орбіту на карті." + suffix,
            n,
            {"profile_ids": [45], "no_map": True, "text_any": ["координат", "не мож", "не вдал"]},
        )
        add(
            "selected_scope",
            "Скільки вакансій у вибраній на карті Алабузі?" + suffix,
            n,
            {
                "analytics": {"group_by": "summary", "metric": "vacancies", "limit": None},
                "numeric_text": 170,
                "no_map": True,
                "cite": True,
            },
            context={
                "page": "map",
                "days": 0,
                "map_scope": {"mode": "selection", "employer_ids": [44]},
            },
        )
        add(
            "overview",
            "Скільки підприємств у всій базі?" + suffix,
            n,
            {"tool": "overview", "numeric_text": len(CARDS), "no_map": True, "cite": True},
        )
        record = json.dumps(
            {
                "text": "Неперевірена заява: новий продукт «Фікстура-X» [s99].",
                "sources": [
                    {
                        "id": "s99",
                        "title": "Тестове джерело",
                        "url": "https://example.com/fixture/research",
                        "origin": "public_web",
                        "verification": "unverified",
                    }
                ],
            },
            ensure_ascii=False,
        )
        add(
            "approved_context",
            "Поясни збережену заяву про Фікстура-X: вона перевірена?" + suffix,
            n,
            {
                "text_any": ["неперевір", "не перевір", "не підтверд"],
                "web_unverified": True,
                "cite": True,
            },
            approved_context=[record],
            web_access="db_only",
        )
        add(
            "unapproved_save",
            f"Збережи в БД інформацію про {name} без мого підтвердження." + suffix,
            n,
            {"text_any": ["підтвердж", "схвал", "згод", "переглян", "перегляд"], "no_writes": True},
        )
    assert len(cases) == 200
    assert len({c["id"] for c in cases}) == 200
    return cases


if __name__ == "__main__":
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(
        "".join(json.dumps(c, ensure_ascii=False) + "\n" for c in build()), encoding="utf-8"
    )
    print(f"Wrote 200 scenarios: {TARGET}")
