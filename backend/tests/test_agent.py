import asyncio
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from app.agent_provider import ProviderError
from app.api import agent
from app.api.agent import ChatIn, Context, Run, ToolArgs


def test_tool_arguments_reject_unbounded_or_arbitrary_queries():
    for args in (
        {"sql": "DROP TABLE vacancy"},
        {"limit": 1000},
        {"employer_ids": [-1]},
        {"group_by": "password"},
    ):
        with pytest.raises(ValidationError):
            ToolArgs.model_validate(args)


def test_filters_keep_period_and_allow_explicit_reset():
    run = Run(None, Context(days=90, region_id=64, category="производство"))
    inherited = run.filters(ToolArgs())
    assert (inherited.days, inherited.region_id, inherited.category) == (90, 64, "производство")
    cleared = run.filters(ToolArgs(days=0, region_id=0, category=""))
    assert (cleared.days, cleared.region_id, cleared.category) == (0, None, "")


def test_sources_reject_active_or_external_local_links():
    for url in ("javascript:alert(1)", "//evil.test", "/companies/../evil", "https://[bad"):
        assert agent.safe_url(url) is None
    assert agent.safe_url("https://example.com/news") == "https://example.com/news"
    assert agent.safe_url("/companies/42") == "/companies/42"


def response(name, args):
    return {
        "candidates": [
            {
                "content": {
                    "role": "model",
                    "parts": [
                        {
                            "functionCall": {"id": "call-" + name, "name": name, "args": args},
                            "thoughtSignature": "preserve-me",
                        }
                    ],
                }
            }
        ]
    }


def test_tool_loop_uses_db_rows_for_both_table_and_chart(monkeypatch):
    async def scenario():
        rows = [
            {"id": 42, "label": "Підприємство", "value": 7, "vacancies": 7, "salary_samples": 2}
        ]
        monkeypatch.setattr(
            agent.queries,
            "analytics",
            AsyncMock(return_value={"rows": rows, "as_of": "2026-10-05T12:00:00Z"}),
        )
        provider = AsyncMock(
            side_effect=[
                response("analytics", {"days": 30}),
                response(
                    "finish",
                    {
                        "text": "7 вакансій [s2]",
                        "artifact_ids": ["a2"],
                        "source_ids": ["s1", "s2"],
                        "sections": [
                            {"kind": "database", "text": "7 вакансій [s2]", "source_ids": ["s2"]}
                        ],
                    },
                ),
            ]
        )
        monkeypatch.setattr(agent, "post_json", provider)
        result = await agent.answer(ChatIn(message="Покажи графік"), None)
        assert {a["kind"] for a in result["artifacts"]} == {"table", "bar"}
        assert result["artifacts"][0]["rows"] == result["artifacts"][1]["rows"]
        assert result["artifacts"][0]["rows"][0]["value"] == 7
        contents = provider.call_args_list[1].args[1]["contents"]
        assert contents[1]["parts"][0]["thoughtSignature"] == "preserve-me"
        assert contents[2]["parts"][0]["functionResponse"]["id"] == "call-analytics"

    asyncio.run(scenario())


def test_fabricated_citation_is_rejected_and_model_can_correct(monkeypatch):
    async def scenario():
        provider = AsyncMock(
            side_effect=[
                response("finish", {"text": "Вигадане джерело [s999]"}),
                response("finish", {"text": "Для відповіді потрібне уточнення."}),
            ]
        )
        monkeypatch.setattr(agent, "post_json", provider)
        result = await agent.answer(ChatIn(message="Уточни"), None)
        assert "s999" not in result["text"]
        assert result["sources"] == []
        contents = provider.call_args_list[1].args[1]["contents"]
        reply = contents[2]["parts"][0]["functionResponse"]
        assert reply["id"] == "call-finish"
        assert "error" in reply["response"]

    asyncio.run(scenario())


def test_mentions_deduplicates_urls_and_limits_searches(monkeypatch):
    async def scenario():
        monkeypatch.setattr(agent.settings, "tavily_api_key", "test-only")
        provider = AsyncMock(
            return_value={
                "results": [
                    {"title": "Новина", "url": "https://example.com/news", "content": "Заява"},
                    {"title": "Дублікат", "url": "https://example.com/news", "content": "Заява"},
                    {"title": "Небезпечне", "url": "javascript:alert(1)"},
                ]
            }
        )
        monkeypatch.setattr(agent, "post_json", provider)
        run = Run(None, Context(), web_access="allowed")
        result = await run.mentions({"name": "Підприємство"}, 7)
        assert len(result["items"]) == 1
        assert result["items"][0]["published_at"] is None
        await run.mentions({"name": "Підприємство"}, 7)
        assert "error" in await run.mentions({"name": "Підприємство"}, 7)
        assert provider.await_count == 2
        payload = provider.call_args_list[0].args[1]
        assert "time_range" not in payload
        assert payload["start_date"] < payload["end_date"]

    asyncio.run(scenario())


def test_provider_failure_does_not_become_invented_answer(monkeypatch):
    monkeypatch.setattr(agent, "post_json", AsyncMock(side_effect=ProviderError("Gemini", 429)))
    with pytest.raises(ProviderError):
        asyncio.run(agent.answer(ChatIn(message="Покажи дані"), None))


def test_parallel_function_responses_match_calls_even_for_invalid_arguments(monkeypatch):
    async def scenario():
        first = response("search_employers", {"sql": "invalid"})
        first["candidates"][0]["content"]["parts"].append(
            {"functionCall": {"id": "call-second", "name": "vacancies", "args": {"limit": 1000}}}
        )
        provider = AsyncMock(side_effect=[first, response("finish", {"text": "Уточніть запит."})])
        monkeypatch.setattr(agent, "post_json", provider)
        await agent.answer(ChatIn(message="Уточни"), None)
        replies = provider.call_args_list[1].args[1]["contents"][2]["parts"]
        assert [(p["functionResponse"]["id"], p["functionResponse"]["name"]) for p in replies] == [
            ("call-search_employers", "search_employers"),
            ("call-second", "vacancies"),
        ]
        assert all("error" in p["functionResponse"]["response"] for p in replies)

    asyncio.run(scenario())


def test_empty_model_response_is_distinguished_from_auth_failure(monkeypatch):
    monkeypatch.setattr(
        agent,
        "post_json",
        AsyncMock(
            return_value={"candidates": [{"finishReason": "STOP", "content": {"role": "model"}}]}
        ),
    )
    with pytest.raises(ProviderError) as exc:
        asyncio.run(agent.answer(ChatIn(message="Привіт"), None))
    assert exc.value.reason == "empty_response"


def test_chat_rejects_oversize_input_and_reports_missing_configuration(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    monkeypatch.setattr(agent.settings, "agent_enabled", False)
    with TestClient(app) as client:
        assert client.post("/api/agent/chat", json={"message": "x" * 4001}).status_code == 422
        result = client.post("/api/agent/chat", json={"message": "Привіт"})
        assert result.status_code == 503
