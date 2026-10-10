import json
from copy import deepcopy

from app.agent_input import compact, model_messages, model_tools
from app.api.agent import SYSTEM, TOOLS


def test_compaction_preserves_cited_relationships_and_web_evidence():
    evidence = {
        "relationships": [{"name": "Постачальник", "source_id": "s2", "company_id": 8}],
        "web_evidence": [
            {
                "text": "Компанія анонсує продукт",
                "source_id": "s3",
                "origin": "public_web",
                "verification": "unverified",
            }
        ],
        "profile": {"description": "другорядне " * 100},
    }
    result = compact(evidence, items=1, text_limit=8)
    assert result["relationships"] == evidence["relationships"]
    assert result["web_evidence"] == evidence["web_evidence"]
    assert len(result["profile"]["description"]) < 100


def test_top_five_rows_survive_even_the_smallest_model_excerpt():
    rows = [{"id": n, "label": f"Посада {n}", "value": 10 - n} for n in range(5)]
    result = compact(
        {"rows": rows, "ranking_rows": rows, "ranking_count": 5}, items=1, text_limit=8
    )
    assert len(result["rows"]) == 1
    assert result["ranking_rows"] == rows
    assert result["ranking_count"] == 5


def test_hiring_counts_for_every_company_survive_coordinate_excerpt():
    evidence = {
        "map_action": {"places": [{"employer_id": n} for n in range(5)]},
        "hiring_employers": [
            {"employer_id": 41, "name": "УАЗ", "places": 3},
            {"employer_id": 42, "name": "Калашников", "places": 2},
        ],
    }
    result = compact(evidence, items=1, text_limit=5)
    assert len(result["map_action"]["places"]) == 1
    assert result["hiring_employers"] == evidence["hiring_employers"]


def test_vacancy_details_survive_model_excerpt():
    matches = [{"id": 1, "title": "Диспетчер", "monthly_salary": 85000, "source_id": "s1"}]
    result = compact(
        {
            "items": [{"title": "Диспетчер", "description": "текст" * 1000}],
            "vacancy_matches": matches,
        },
        items=1,
        text_limit=3,
    )
    assert result["vacancy_matches"] == matches


def test_large_overview_is_excerpted_without_mutating_full_evidence_or_call_ids():
    evidence = {
        "vacancies": 42000,
        "source_id": "s1",
        "artifact_ids": ["a1", "a2"],
        "regions_list": [{"region_id": n, "name": "Область " + "я" * 100} for n in range(80)],
    }
    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": "Покажи підсумок платформи"},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call-1",
                    "type": "function",
                    "function": {"name": "overview", "arguments": "{}"},
                }
            ],
        },
        {"role": "tool", "tool_call_id": "call-1", "content": json.dumps(evidence)},
    ]
    before = deepcopy(messages)
    tools = model_tools(TOOLS)
    result = model_messages(messages, tools)
    assert messages == before
    assert (
        len(
            json.dumps(
                {
                    "messages": result,
                    "tools": [{"type": "function", "function": tool} for tool in tools],
                },
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
        )
        <= 12000
    )
    body = json.loads(result[-1]["content"])
    assert body["vacancies"] == 42000 and body["source_id"] == "s1"
    assert body["artifact_ids"] == ["a1", "a2"]
    assert body["_model_excerpt"]["omitted"]["regions_list"] == 80 - len(body["regions_list"])
    assert result[-1]["tool_call_id"] == result[-2]["tool_calls"][0]["id"]
    assert len(evidence["regions_list"]) == 80


def test_large_old_history_is_removed_without_losing_current_question_or_tool_pairs():
    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": "old " * 4000},
        {"role": "assistant", "content": "old " * 4000},
        {"role": "user", "content": "Поточне питання"},
        {
            "role": "assistant",
            "tool_calls": [
                {
                    "id": "c1",
                    "type": "function",
                    "function": {"name": "overview", "arguments": "{}"},
                }
            ],
        },
        {"role": "tool", "tool_call_id": "c1", "content": '{"source_id":"s1"}'},
    ]
    result = model_messages(messages, TOOLS)
    assert result[1]["content"] == "Поточне питання"
    assert result[-1]["tool_call_id"] == result[-2]["tool_calls"][0]["id"]


def test_repeated_compaction_does_not_recursively_expand_excerpt_metadata():
    evidence = {
        "profile": {
            "id": 42,
            "name": "Company",
            "description": "текст " * 2000,
            "locations": [{"name": "місто " * 100} for _ in range(30)],
        },
        "source_id": "s1",
    }
    messages = [
        {"role": "system", "content": "Use only evidence."},
        {"role": "user", "content": "Company profile"},
        {"role": "tool", "tool_call_id": "c1", "content": json.dumps(evidence)},
    ]
    result = model_messages(messages, [], max_bytes=1300)
    body = json.loads(result[-1]["content"])
    assert body["profile"]["id"] == 42 and body["source_id"] == "s1"
    assert "_model_excerpt" not in body["profile"]["_model_excerpt"]
    assert len(json.dumps({"messages": result, "tools": []}, ensure_ascii=False).encode()) <= 1300


def test_wide_company_card_fits_budget_and_keeps_scalar_facts_and_citations():
    tools = model_tools(TOOLS)
    body = {"profile": {"id": 42, "name": "Company", "total_vacancies": 7}, "source_id": "s1"}
    body["profile"].update({f"detail{n}": {"description": "я" * 500} for n in range(60)})
    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": "Company profile"},
        {"role": "tool", "tool_call_id": "c1", "content": json.dumps(body)},
    ]
    result = model_messages(messages, tools)
    encoded = json.dumps(
        {"messages": result, "tools": [{"type": "function", "function": t} for t in tools]},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode()
    assert len(encoded) <= 10000
    excerpt = json.loads(result[-1]["content"])
    assert excerpt["profile"]["id"] == 42
    assert excerpt["profile"]["total_vacancies"] == 7
    assert excerpt["source_id"] == "s1"
