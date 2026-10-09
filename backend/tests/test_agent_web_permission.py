import asyncio
from unittest.mock import AsyncMock

from test_agent import response
from test_agent_map import card

from app.api import agent


def configure(monkeypatch):
    monkeypatch.setattr(agent.settings, "tavily_api_key", "test-only")
    row = {
        **card(41, "Перевірене підприємство"),
        **dict.fromkeys(
            [
                "gur",
                "company_id",
                "company_link",
                "classification",
                "profile",
                "registry",
                "agency",
                "parent_card_id",
            ]
        ),
        **{
            key: []
            for key in [
                "monthly",
                "professions",
                "localities",
                "hiring_locations",
                "sites",
                "contacts",
                "human_reviews",
                "sources",
                "match_conflicts",
            ]
        },
    }
    monkeypatch.setattr(agent.employers, "get_employer", AsyncMock(return_value=row))


def test_default_request_pauses_before_tavily_and_does_not_consume_web_budget(monkeypatch):
    configure(monkeypatch)
    provider = AsyncMock(return_value=response("search_mentions", {"employer_id": 41, "days": 7}))
    monkeypatch.setattr(agent, "post_json", provider)
    result = asyncio.run(agent.answer(agent.ChatIn(message="Знайди свіжі згадки"), None))
    assert result["web_permission"] == {"company": "Перевірене підприємство", "days": 7}
    assert result["sources"] == [] and result["map_action"] is None
    assert provider.await_count == 1
    assert provider.call_args.args[3] == "Gemini"

    async def direct_tool():
        run = agent.Run(None, agent.Context())
        try:
            await run.mentions({"name": "Перевірене підприємство"}, 7)
        except agent.WebPermissionRequired:
            pass
        else:
            raise AssertionError("Permission was not requested")
        assert run.web_calls == 0

    asyncio.run(direct_tool())
    assert provider.await_count == 1


def test_database_only_blocks_even_a_model_attempt_and_removes_web_tool(monkeypatch):
    configure(monkeypatch)
    provider = AsyncMock(
        side_effect=[
            response("search_mentions", {"employer_id": 41}),
            response("finish", {"text": "У базі немає свіжих згадок."}),
        ]
    )
    monkeypatch.setattr(agent, "post_json", provider)
    result = asyncio.run(
        agent.answer(agent.ChatIn(message="Знайди новини", web_access="db_only"), None)
    )
    assert "web_permission" not in result
    assert result["sources"] == []
    agent.employers.get_employer.assert_not_awaited()
    for call in provider.call_args_list:
        assert call.args[3] == "Gemini"
        assert "search_mentions" not in {
            t["name"] for t in call.args[1]["tools"][0]["functionDeclarations"]
        }
    replies = provider.call_args_list[1].args[1]["contents"][2]["parts"]
    assert "database only" in replies[0]["functionResponse"]["response"]["error"]


def test_permission_allows_tavily_with_preserved_provenance(monkeypatch):
    configure(monkeypatch)
    provider = AsyncMock(
        side_effect=[
            response("search_mentions", {"employer_id": 41}),
            {
                "results": [
                    {"title": "Матеріал", "url": "https://example.com/news", "content": "Заява"}
                ]
            },
            response(
                "finish",
                {
                    "text": "Заява джерела [s2]",
                    "sections": [
                        {"kind": "public_web", "text": "Заява джерела [s2]", "source_ids": ["s2"]}
                    ],
                },
            ),
        ]
    )
    monkeypatch.setattr(agent, "post_json", provider)
    result = asyncio.run(
        agent.answer(agent.ChatIn(message="Знайди новини", web_access="allowed"), None)
    )
    assert "web_permission" not in result
    assert [call.args[3] for call in provider.call_args_list] == ["Gemini", "Tavily", "Gemini"]
    assert result["sections"][0]["kind"] == "public_web"
    assert result["sources"][1]["origin"] == "public_web"
    assert result["sources"][1]["excerpt"] == "Заява"


def test_history_does_not_authorize_next_question(monkeypatch):
    configure(monkeypatch)
    provider = AsyncMock(return_value=response("search_mentions", {"employer_id": 41}))
    monkeypatch.setattr(agent, "post_json", provider)
    result = asyncio.run(
        agent.answer(
            agent.ChatIn(
                message="Ще новини",
                history=[agent.History(role="user", text="Я дозволив інтернет раніше")],
            ),
            None,
        )
    )
    assert result["web_permission"]
    assert provider.await_count == 1


def test_plain_database_question_does_not_request_permission(monkeypatch):
    monkeypatch.setattr(
        agent,
        "post_json",
        AsyncMock(return_value=response("finish", {"text": "Уточніть підприємство."})),
    )
    result = asyncio.run(agent.answer(agent.ChatIn(message="Про яке підприємство є дані?"), None))
    assert "web_permission" not in result
