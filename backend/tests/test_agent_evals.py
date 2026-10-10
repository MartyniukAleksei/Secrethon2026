import json
from pathlib import Path

from app import agent_eval as evaluation

DATASET = Path(__file__).resolve().parents[1] / "evals/agent_scenarios.jsonl"


def trace():
    return {"tools": [], "analytics": [], "web_calls": 0, "writes": 0}


def case(ident):
    return next(c for c in evaluation.load_cases(DATASET) if c["id"] == ident)


def test_dataset_has_200_unique_scenarios_and_separate_holdout():
    cases = evaluation.load_cases(DATASET)
    assert len(cases) == 200
    assert sum(c["split"] == "development" for c in cases) == 160
    assert sum(c["split"] == "heldout" for c in cases) == 40
    assert len({c["family"] for c in cases}) == 20
    assert len({c["request"]["message"] for c in cases}) >= 160
    development = {
        json.dumps(c["request"], sort_keys=True) for c in cases if c["split"] == "development"
    }
    heldout = {json.dumps(c["request"], sort_keys=True) for c in cases if c["split"] == "heldout"}
    assert not development & heldout


def test_grader_rejects_salary_ranking_with_wrong_scope_and_values():
    c = case("salary_city-01")
    t = trace()
    t["analytics"] = [
        {
            "group_by": "category",
            "metric": "median_salary",
            "query": "",
            "limit": 5,
            "employer_ids": [],
            "filters": {"region_id": None, "employer_id": 44, "employer_ids": [44]},
        }
    ]
    result = {
        "text": "Рейтинг [s1]",
        "sources": [{"id": "s1"}],
        "artifacts": [{"kind": "table", "rows": [{"id": 44, "value": 100000}]}],
    }
    failures = evaluation.grade(c, result, t)
    assert "wrong_analytics_query_or_scope" in failures
    assert "wrong_ranking_rows" in failures
    assert "wrong_ranking_values" in failures


def test_grader_accepts_correct_city_ranking_without_one_fixed_wording():
    c = case("salary_city-01")
    t = trace()
    t["analytics"] = [
        {
            "group_by": "company",
            "metric": "median_salary",
            "query": "",
            "limit": 5,
            "employer_ids": [],
            "filters": {"region_id": 1, "employer_id": None, "employer_ids": None},
        }
    ]
    result = {
        "text": "Компанії з найбільшою медіаною зарплати в Москві [s1]",
        "sources": [{"id": "s1"}],
        "artifacts": [
            {
                "kind": "table",
                "rows": [
                    {"id": ident, "value": value}
                    for ident, value in zip(
                        c["expect"]["table_ids"], c["expect"]["table_values"], strict=True
                    )
                ],
            }
        ],
    }
    assert evaluation.grade(c, result, t) == []


def test_grader_rejects_permission_bypass_and_fabricated_citation():
    c = case("web_permission-01")
    t = trace()
    t["web_calls"] = 1
    result = {"text": "Знайшов новини [s999]", "sources": [], "map_action": None}
    failures = evaluation.grade(c, result, t)
    assert "unexpected_web_execution" in failures
    assert "wrong_web_permission" in failures
    assert "fabricated_source_id" in failures


def test_grader_rejects_storage_approval_as_verification():
    c = case("approved_context-01")
    result = {
        "text": "Не перевірено [s1]",
        "sources": [{"id": "s1", "origin": "public_web", "verification": "user_verified"}],
    }
    assert "web_claim_promoted_to_verified" in evaluation.grade(c, result, trace())


def test_hiring_grader_rejects_headquarters_and_russian_sections():
    scenario = {
        "family": "hiring_one",
        "expect": {
            "hiring_map": [[41, 55, 37], [41, 56, 38]],
            "ukrainian": True,
        },
    }
    result = {
        "text": "Показано місця найму.",
        "map_action": {
            "kind": "show_hiring_places",
            "places": [
                {"employer_id": 41, "lat": 60, "lng": 70},
            ],
        },
        "sections": [{"text": "Это данные за весь период."}],
    }
    failures = evaluation.grade(scenario, result, trace())
    assert "wrong_hiring_locations" in failures
    assert "russian_narrative" in failures
    result["map_action"]["places"] = [
        {"employer_id": 41, "lat": 55, "lng": 37},
        {"employer_id": 41, "lat": 56, "lng": 38},
    ]
    result["sections"] = [{"text": "Дані за весь доступний період."}]
    assert evaluation.grade(scenario, result, trace()) == []
