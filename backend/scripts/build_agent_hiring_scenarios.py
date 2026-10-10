"""Freeze additional language and hiring-map regression/holdout questions."""

import json
from pathlib import Path

points = [
    {"employer_id": 41, "lat": 55.0, "lng": 37.0, "vacancies": 2},
    {"employer_id": 41, "lat": 56.0, "lng": 38.0, "vacancies": 3},
    {"employer_id": 41, "lat": 57.0, "lng": 39.0, "vacancies": 4},
    {"employer_id": 42, "lat": 52.0, "lng": 30.0, "vacancies": 5},
    {"employer_id": 42, "lat": 53.0, "lng": 31.0, "vacancies": 6},
]
groups = {
    "hiring_one": [
        "Покажи декілька місць найму УАЗ на карті",
        "Покажи 2 місця найму УАЗ на карті",
        "Наблизь на карті місця найму UAZ",
        "Хочу побачити на карті всі місця найму УАЗ",
        "Покажи 3 місця найму УАЗ",
    ],
    "hiring_many": [
        "Покажи місця найму УАЗ і Калашникова на карті",
        "Покажи місця найму Калашникова та УАЗ",
        "Наблизь на карті місця найму УАЗ та Калашникова",
        "На карті покажи місця найму UAZ і Калашникова",
        "Де місця найму УАЗ та Калашникова? Покажи на карті",
    ],
    "hiring_followup": [
        "Покажи його місця найму на карті",
        "Покажи місця найму цього підприємства",
        "Наблизь місця найму на карті",
        "Покажи на карті всі його місця найму",
        "Покажи 2 місця найму цього підприємства",
    ],
    "ukrainian_vacancy": [
        "Чи треба в НПО Алмаз диспетчер?",
        "Чи є вакансія диспетчера в НПО Алмаз?",
        "Розкажи українською про вакансії НПО Алмаз",
        "НПО Алмаз шукає диспетчера?",
        "Що відомо про вакансії НПО Алмаз? Відповідай українською",
    ],
}
cases = []
for family, questions in groups.items():
    for index, message in enumerate(questions):
        language = family == "ukrainian_vacancy"
        expected = {
            "ukrainian": True,
            "cite": True,
            "permission": False,
            "profile_ids": [41],
            "web_calls": 0,
            "no_writes": True,
        }
        if language:
            expected["map"] = {"kind": "focus_company", "employer_id": 41}
        else:
            selected = points if family == "hiring_many" else points[:3]
            if "2 місця" in message:
                selected = selected[:2]
            expected["hiring_map"] = [[p["employer_id"], p["lat"], p["lng"]] for p in selected]
            if family == "hiring_many":
                expected["profile_ids"] = [41, 42]
        cases.append(
            {
                "id": f"{family}-{index + 1:02d}",
                "version": 1,
                "split": "development" if index < 3 else "heldout",
                "family": family,
                "data_mode": "synthetic_fixture",
                "request": {
                    "message": message,
                    "context": {
                        "page": "map",
                        "company_id": 41 if family == "hiring_followup" else 43,
                        "days": 0,
                    },
                    "web_access": "db_only",
                },
                "fixture_variant": {
                    "employer_names": {
                        "41": "НПО Алмаз" if language else "УАЗ",
                        "42": "Калашников",
                    },
                    "hiring_points": points,
                },
                "expect": expected,
            }
        )
target = Path(__file__).resolve().parents[1] / "evals/agent_language_hiring.jsonl"
target.write_text(
    "".join(json.dumps(c, ensure_ascii=False) + "\n" for c in cases), encoding="utf-8"
)
print(f"Wrote {len(cases)} scenarios (12 development, 8 heldout)")
