import asyncio
from unittest.mock import AsyncMock

from app.agent_intent import analytics_plan, needs_ranking_criterion, question_days, region_for_city
from app.api import agent


def test_explicit_global_ranking_overrides_map_action_phrase():
    plan = analytics_plan("Топ 5 компаній за кількістю вакансій по всій базі. Покажи на карті.")
    assert plan.global_scope and plan.group_by == "company" and plan.metric == "vacancies"


def test_salary_city_is_geography_and_cannot_be_employer_name_query():
    plan = analytics_plan("Топ 5 найкращих по ЗП компаній в Москві")
    assert plan.city == "Москва" and plan.global_scope
    assert plan.arguments(77)["query"] == ""
    assert plan.arguments(77)["region_id"] == 77
    assert region_for_city("Казань", [{"region_id": 3, "name": "Татарстан"}]) is None


def test_production_ranking_needs_explicit_criterion():
    assert needs_ranking_criterion("Топ 10 компаній по виробництву ракет")
    assert not needs_ranking_criterion("Топ 10 виробників ракет за кількістю вакансій")


def test_global_rankings_keep_period_unless_question_overrides_it():
    assert question_days("Топ 5 компаній за зарплатою", 30) == 30
    assert question_days("Топ 5 компаній за весь період", 30) == 0
    assert question_days("Топ 5 компаній за останні 90 днів", 30) == 90
    assert analytics_plan("Топ 5 за зарплатою").arguments(1, 90)["days"] == 90


def test_ambiguous_name_cannot_search_open_profile_or_move_map(monkeypatch):
    directory = AsyncMock(
        return_value=[
            {"id": 1, "name": "Омега Москва"},
            {"id": 2, "name": "Омега Петербург"},
        ]
    )
    monkeypatch.setattr(agent.employers, "list_employers", directory)
    provider = AsyncMock()
    monkeypatch.setattr(agent, "post_json", provider)
    result = asyncio.run(agent.answer(agent.ChatIn(message="Що виробляє Омега?"), object()))
    assert "Уточни" in result["text"] and result["map_action"] is None
    provider.assert_not_awaited()


def test_scoped_retrieval_requires_verified_identity(monkeypatch):
    retrieve = AsyncMock()
    monkeypatch.setattr(agent.rag, "retrieve", retrieve)
    result = asyncio.run(
        agent.Run(None, agent.Context(company_id=44)).tool(
            "search_knowledge",
            {"query": "Омега", "employer_id": 44},
        )
    )
    assert "error" in result
    retrieve.assert_not_awaited()
