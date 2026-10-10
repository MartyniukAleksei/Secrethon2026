import asyncio
import json
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError

from app import research as storage
from app.api import agent, research
from app.db import get_session


def payload():
    return {
        "id": str(uuid4()),
        "title": "Дослідження",
        "question": "Новини підприємства",
        "employer_id": 41,
        "context": {"days": 30},
        "approved": True,
        "response": {
            "text": "Заява джерела [s1]",
            "artifacts": [],
            "as_of": None,
            "tools_used": [],
            "sources": [
                {
                    "id": "s1",
                    "title": "Новина",
                    "url": "https://example.com/news",
                    "origin": "public_web",
                    "verification": "unverified",
                }
            ],
            "sections": [{"kind": "public_web", "text": "Заява [s1]", "source_ids": ["s1"]}],
        },
    }


def client_for_tests():
    app = FastAPI()
    app.include_router(research.router, prefix="/api")
    app.dependency_overrides[get_session] = lambda: None
    return TestClient(app)


@pytest.mark.parametrize(
    "change",
    [
        "no_approval",
        "rejected",
        "no_verification",
        "fake_database",
        "missing_citation",
        "unsafe_url",
        "wrong_origin",
        "oversize",
    ],
)
def test_storage_requires_approval_and_valid_provenance(monkeypatch, change):
    save = AsyncMock()
    monkeypatch.setattr(storage, "save_research", save)
    data = payload()
    source = data["response"]["sources"][0]
    if change == "no_approval":
        data.pop("approved")
    elif change == "rejected":
        data["approved"] = False
    elif change == "no_verification":
        source.pop("verification")
    elif change == "fake_database":
        source["verification"] = "database_record"
    elif change == "missing_citation":
        data["response"]["sources"] = []
    elif change == "unsafe_url":
        source["url"] = "javascript:alert(1)"
    elif change == "wrong_origin":
        data["response"]["sections"][0]["kind"] = "database"
    else:
        data["response"]["text"] = "x" * 24001
    with client_for_tests() as client:
        assert client.post("/api/agent/research", json=data).status_code == 422
    save.assert_not_awaited()


@pytest.mark.parametrize("verification", ["unverified", "user_verified"])
def test_approved_info_column_retains_user_verification_and_resolves_card(
    monkeypatch, verification
):
    data = payload()
    data["response"]["sources"][0]["verification"] = verification
    card = AsyncMock(return_value=43)
    monkeypatch.setattr(research.employers, "card_of", card)
    saved = {**data, "approved_at": "2026-10-10T12:00:00Z", "schema_version": 1}
    save = AsyncMock(return_value=saved)
    monkeypatch.setattr(storage, "save_research", save)
    with client_for_tests() as client:
        result = client.post("/api/agent/research", json=data)
    assert result.status_code == 201
    values = save.call_args.args[0]
    assert values["employer_id"] == 43
    assert values["approved_info"]["sources"][0]["verification"] == verification
    assert values["approved_info"]["sources"][0]["origin"] == "public_web"


def test_unknown_company_and_database_failure_are_not_reported_as_saved(monkeypatch):
    save = AsyncMock(side_effect=SQLAlchemyError("storage failed"))
    card = AsyncMock(return_value=None)
    monkeypatch.setattr(research.employers, "card_of", card)
    monkeypatch.setattr(storage, "save_research", save)
    with client_for_tests() as client:
        assert client.post("/api/agent/research", json=payload()).status_code == 404
        save.assert_not_awaited()
        card.return_value = 41
        assert client.post("/api/agent/research", json=payload()).status_code == 503


def test_read_before_first_save_does_not_create_schema():
    session = AsyncMock()
    session.scalar.return_value = None
    assert asyncio.run(storage.list_research(session)) == []
    session.execute.assert_not_awaited()


def test_storage_serializes_approved_info_separately_and_retries_do_not_append(monkeypatch):
    data = payload()
    values = {
        "id": data["id"],
        "employer_id": 41,
        "title": data["title"],
        "question": data["question"],
        "context": data["context"],
        "approved_info": data["response"],
        "parent_id": None,
    }
    insert = AsyncMock(return_value={**values, "approved_at": "2026-10-10T12:00:00Z"})
    monkeypatch.setattr(storage, "_insert", insert)
    result = asyncio.run(storage.save_research(values))
    statement, params = insert.call_args.args
    assert "approved_info" in statement and "ON CONFLICT (id)" in statement
    assert json.loads(params["approved_info"]) == data["response"]
    assert json.loads(params["context"]) == data["context"]
    assert result["response"]["sources"][0]["verification"] == "unverified"
    assert (
        "CREATE TABLE IF NOT EXISTS web_reviews.agent_research"
        in insert.call_args.kwargs["extra_ddl"][0]
    )


def test_saved_research_keeps_web_status_and_remaps_citations(monkeypatch):
    data = payload()
    saved = {"title": data["title"], "response": data["response"], "approved_at": "2026-10-10"}
    monkeypatch.setattr(storage, "list_research", AsyncMock(return_value=[saved]))
    run = agent.Run(None, agent.Context())
    run.profiles[41] = {"id": 41}
    run.source("Картка", "/companies/41")
    result = asyncio.run(run.tool("saved_research", {"employer_id": 41}))
    assert result["items"][0]["text"] == "Заява джерела [s2]"
    assert run.sources["s2"]["origin"] == "public_web"
    assert run.sources["s2"]["verification"] == "unverified"


def test_chat_context_is_bounded_and_cannot_authorize_web(monkeypatch):
    from test_agent import response

    provider = AsyncMock(return_value=response("finish", {"text": "Уточніть підприємство."}))
    monkeypatch.setattr(agent, "post_json", provider)
    asyncio.run(
        agent.answer(
            agent.ChatIn(message="Уточнення", approved_context=["Схвалений контекст"]), None
        )
    )
    prompt = provider.call_args.args[1]["messages"][0]["content"]
    assert "Схвалений контекст" in prompt and "requires permission" in prompt
    with pytest.raises(ValueError):
        agent.ChatIn(message="Уточнення", approved_context=["x" * 12001])


def test_pinned_context_citations_are_available_with_original_web_provenance(monkeypatch):
    from test_agent import response

    context = json.dumps(
        {
            "title": "Попереднє дослідження",
            "text": "Заява [s8]",
            "sources": [
                {
                    "id": "s8",
                    "title": "Матеріал",
                    "url": "https://example.com/news",
                    "origin": "public_web",
                    "verification": "unverified",
                }
            ],
        }
    )
    provider = AsyncMock(
        return_value=response(
            "finish",
            {
                "text": "Раніше збережена заява [s1]",
                "sections": [
                    {
                        "kind": "public_web",
                        "text": "Раніше збережена заява [s1]",
                        "source_ids": ["s1"],
                    }
                ],
            },
        )
    )
    monkeypatch.setattr(agent, "post_json", provider)
    result = asyncio.run(
        agent.answer(
            agent.ChatIn(message="Використай попередній матеріал", approved_context=[context]), None
        )
    )
    assert result["sources"][0]["url"] == "https://example.com/news"
    assert result["sources"][0]["verification"] == "unverified"
    assert result["sources"][0]["origin"] == "public_web"
    assert "Заява [s1]" in provider.call_args.args[1]["messages"][0]["content"]
