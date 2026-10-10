import asyncio
from unittest.mock import AsyncMock

import pytest
from test_agent import response

from app.agent_routing import named_companies, proposes_web_search
from app.api import agent

ROWS = [
    {"id": 4064, "name": "Алабуга. Эксплуатация объектов"},
    {"id": 4653, "name": "Калашников. Вакансии для специалистов и руководителей"},
]


@pytest.mark.parametrize("name", ["Калашников", "Калашніков", "Kalashnikov", "Калашникова"])
def test_new_name_is_resolved_despite_current_company(name):
    assert named_companies(f"Що виробляє {name}?", ROWS) == [ROWS[1]]


def test_comparison_and_ambiguous_names_are_not_resolved_as_single_company():
    assert len(named_companies("Порівняй Алабугу і Калашников", ROWS)) == 2
    assert len(named_companies("Калашников", [*ROWS, {"id": 99, "name": "АО Калашников"}])) == 2
    assert named_companies("А що він виробляє?", ROWS) == []
    assert named_companies("Скільки вакансій на карті?", ROWS) == []


@pytest.mark.parametrize("question", ["УАЗ", "UAZ", "Графік топ 5 вакансій УАЗ"])
def test_short_exact_name_wins_over_branch_alias_and_different_acronym(question):
    rows = [
        {"id": 1, "name": "УАЗ", "gur_name": "АО УАЗ"},
        {"id": 2, "name": "МОСКОВСКИЙ ФИЛИАЛ ООО УАЗ", "gur_name": "АО УАЗ"},
        {"id": 3, "name": "АО У-УАЗ"},
    ]
    assert named_companies(question, rows) == [{"id": 1, "name": "УАЗ"}]


def test_short_names_do_not_match_inside_other_words():
    assert named_companies("КамАЗ", [{"id": 1, "name": "УАЗ"}]) == []


def test_specific_name_does_not_include_a_shorter_different_company():
    rows = [{"id": 1, "name": "НПО Алмаз"}, {"id": 2, "name": 'АО "АЛМАЗ"'}]
    assert named_companies("Чи треба в НПО Алмаз диспетчер?", rows) == [rows[0]]
    assert named_companies("Порівняй НПО Алмаз і АО Алмаз", rows) == rows


@pytest.mark.parametrize(
    "text",
    [
        "Потрібна перевірка вебджерел.",
        "Для відповіді потрібне уточнення і перевірка загальнодоступних відомостей.",
        "Можу пошукати в інтернеті.",
    ],
)
def test_web_proposal_is_detected(text):
    assert proposes_web_search(text)


@pytest.mark.parametrize("access, permission", [("ask", True), ("db_only", False)])
def test_named_company_focus_and_web_offer_finish_guard(monkeypatch, access, permission):
    monkeypatch.setattr(agent.settings, "tavily_api_key", "test-only")
    monkeypatch.setattr(agent.employers, "list_employers", AsyncMock(return_value=ROWS))

    async def tools(run, name, raw):
        assert raw["employer_id"] == 4653
        if name == "company_profile":
            run.profiles[4653] = ROWS[1]
            return {"profile": ROWS[1]}
        assert name == "show_on_map"
        run.map_action = {"kind": "focus_company", "employer_id": 4653}
        return {"source_id": "s1"}

    monkeypatch.setattr(agent.Run, "tool", tools)
    provider = AsyncMock(return_value=response("finish", {"text": "Потрібна перевірка вебджерел."}))
    monkeypatch.setattr(agent, "post_json", provider)
    result = asyncio.run(
        agent.answer(
            agent.ChatIn(
                message="Що виробляє Калашников?",
                context=agent.Context(page="map", company_id=4064),
                history=[agent.History(role="assistant", text="Відкрито Алабугу.")],
                web_access=access,
            ),
            object(),
        )
    )
    assert result["map_action"] == {"kind": "focus_company", "employer_id": 4653}
    assert bool(result.get("web_permission")) is permission
    assert provider.await_count == 1  # No Tavily request before consent.
    assert "employer_id=4653" in provider.call_args.args[1]["messages"][0]["content"]
