import asyncio
from unittest.mock import AsyncMock

from test_agent import response

from app.agent_eval_fixtures import FixtureSession
from app.agent_language import russian_prose
from app.api import agent


def test_language_allows_original_names_but_rejects_russian_explanation():
    assert russian_prose("У НПО «Алмаз» в базе есть 1 вакансия по запросу «диспетчер».")
    assert not russian_prose("У НПО «Алмаз» є одна вакансія «Слесарь». [s1]")


def test_russian_finish_is_rewritten_before_display(monkeypatch):
    provider = AsyncMock(
        side_effect=[
            response("finish", {"text": "В базе есть одна вакансия."}),
            response("finish", {"text": "У базі є одна вакансія."}),
        ]
    )
    monkeypatch.setattr(agent, "post_json", provider)
    result = asyncio.run(agent.answer(agent.ChatIn(message="Чи потрібен диспетчер?"), None))
    assert result["text"] == "У базі є одна вакансія."
    assert provider.await_count == 2


def test_save_confirmation_must_appear_in_displayed_sections(monkeypatch):
    provider = AsyncMock(
        return_value=response(
            "finish",
            {
                "text": "Для збереження потрібне підтвердження.",
                "sections": [
                    {"kind": "analysis", "text": "Відомості підготовлено.", "source_ids": []}
                ],
            },
        )
    )
    monkeypatch.setattr(agent, "post_json", provider)
    result = asyncio.run(agent.answer(agent.ChatIn(message="Збережи в БД інформацію"), None))
    assert "підтвердь збереження" in result["text"]
    assert "Запис ще не виконано" in result["text"]


def test_vacancy_search_preserves_citable_details_for_model(monkeypatch):
    row = {key: None for key in agent.VacancyOut.model_fields}
    row.update(
        id=1,
        source="hh",
        url="https://example.com/vacancy/1",
        employer_id=41,
        title="Диспетчер",
        level="confirmed",
        final_category="vpk",
        final_basis="company_vpk",
        has_markers=False,
        locality="Москва",
        monthly_salary=85000,
        salary_currency="RUB",
    )
    monkeypatch.setattr(agent.vacancies, "list_vacancies", AsyncMock(return_value=(1, [row])))
    run = agent.Run(FixtureSession(), agent.Context())
    result = asyncio.run(run.tool("vacancies", {"employer_id": 41, "query": "диспетчер"}))
    detail = result["vacancy_matches"][0]
    assert detail["title"] == "Диспетчер"
    assert detail["monthly_salary"] == 85000
    assert run.sources[detail["source_id"]]["url"] == row["url"]


def test_hiring_map_uses_multiple_verified_places_and_no_registry_office(monkeypatch):
    monkeypatch.setattr(
        agent.employers,
        "map_points",
        AsyncMock(
            return_value=[
                {"employer_id": 1, "lat": 55.0, "lng": 37.0},
                {"employer_id": 1, "lat": 56.0, "lng": 38.0},
                {"employer_id": 2, "lat": 57.0, "lng": 39.0},
                {"employer_id": 99, "lat": 58.0, "lng": 40.0},
            ]
        ),
    )
    run = agent.Run(None, agent.Context())
    run.profiles = {1: {"id": 1, "name": "A"}, 2: {"id": 2, "name": "B"}}
    result = asyncio.run(
        run.tool(
            "show_on_map", {"employer_ids": [1, 2], "map_mode": "show_hiring_places", "limit": 3}
        )
    )
    assert result["map_action"]["kind"] == "show_hiring_places"
    assert len(result["map_action"]["places"]) == 3
    assert {p["employer_id"] for p in result["map_action"]["places"]} == {1, 2}
    assert "error" in asyncio.run(
        run.tool("show_on_map", {"employer_ids": [99], "map_mode": "show_hiring_places"})
    )
