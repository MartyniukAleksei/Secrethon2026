"""Additional regressions for the reported UAZ/company vacancy chart bug."""

import json
from pathlib import Path

questions = [
    "УАЗ",
    "UAZ",
    "Графік топ 5 вакансій УАЗ",
    "Покажи топ 5 вакансій УАЗ за весь період",
    "Графік топ 3 вакансій UAZ",
    "Скільки вакансій УАЗ?",
]
cases = []
for index, question in enumerate(questions):
    expect = {
        "map": {"kind": "focus_company", "employer_id": 41},
        "profile_ids": [41],
        "cite": True,
        "no_writes": True,
        "permission": False,
    }
    if "топ" in question:
        count = 3 if "топ 3" in question else 5
        expect.update(
            analytics={
                "group_by": "profession",
                "metric": "vacancies",
                "employer_id": 41,
                "limit": count,
            },
            table_ids=["Інженер", "Токар", "Слюсар", "Електрик", "Оператор"][:count],
            table_values=[150, 90, 70, 50, 27][:count],
            text_all=["150", "90", "70"],
        )
    elif "Скільки" in question:
        expect.update(
            analytics={"group_by": "summary", "metric": "vacancies", "employer_id": 41},
            numeric_text=387,
        )
    cases.append(
        {
            "id": f"company-vacancies-{index + 1:02d}",
            "version": 1,
            "split": "development",
            "family": "company_vacancies",
            "data_mode": "synthetic_fixture",
            "request": {
                "message": question,
                "context": {
                    "page": "map",
                    "company_id": 43,
                    "days": 0,
                    "map_scope": {"mode": "selection", "employer_ids": [43]},
                },
                "web_access": "db_only",
            },
            "fixture_variant": {"employer_names": {"41": "УАЗ"}},
            "expect": expect,
        }
    )
target = Path(__file__).resolve().parents[1] / "evals/agent_company_rankings.jsonl"
target.write_text(
    "".join(json.dumps(case, ensure_ascii=False) + "\n" for case in cases), encoding="utf-8"
)
print(f"Wrote {len(cases)} additional scenarios")
