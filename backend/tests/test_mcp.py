import asyncio
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from sqlalchemy.exc import SQLAlchemyError

from app import mcp_server
from app.config import settings
from app.main import app


@asynccontextmanager
async def client_session():
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://localhost",
            headers={"Authorization": "Bearer test-mcp-key"},
        ) as http:
            async with streamable_http_client("http://localhost/mcp/", http_client=http) as (
                read,
                write,
                _,
            ):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    yield session


def configure(monkeypatch):
    monkeypatch.setattr(settings, "mcp_api_key", "test-mcp-key")
    monkeypatch.setattr(settings, "mcp_enabled", True)


def test_http_requires_separate_key_and_fails_closed(monkeypatch):
    async def scenario():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://localhost"
        ) as http:
            monkeypatch.setattr(settings, "mcp_api_key", "")
            assert (await http.post("/mcp/", json={})).status_code == 503
            configure(monkeypatch)
            assert (await http.post("/mcp/", json={})).status_code == 401
            assert (
                await http.post("/mcp/", json={}, headers={"Authorization": "Bearer wrong"})
            ).status_code == 401
            monkeypatch.setattr(settings, "mcp_enabled", False)
            assert (
                await http.post("/mcp/", json={}, headers={"Authorization": "Bearer test-mcp-key"})
            ).status_code == 503

    asyncio.run(scenario())


def test_sdk_negotiation_lists_tools_resource_and_prompt(monkeypatch):
    configure(monkeypatch)
    monkeypatch.setattr(settings, "site_password", "test-site-password")

    async def scenario():
        async with client_session() as session:
            tools = (await session.list_tools()).tools
            assert {tool.name for tool in tools} == {
                "search_employers",
                "company_profile",
                "analytics",
                "vacancies",
                "overview",
                "search_mentions",
            }
            assert all(tool.annotations.readOnlyHint for tool in tools)
            assert all(tool.name != "finish" for tool in tools)
            resources = await session.list_resources()
            assert str(resources.resources[0].uri) == "secrethon://methodology"
            method = await session.read_resource("secrethon://methodology")
            assert "RUB" in method.contents[0].text
            prompts = await session.list_prompts()
            assert prompts.prompts[0].name == "research_company"
            prompt = await session.get_prompt("research_company", {"company": "Підприємство"})
            assert "search_employers" in prompt.messages[0].content.text

    asyncio.run(scenario())


def test_site_basic_auth_and_mcp_bearer_key_are_independent(monkeypatch):
    configure(monkeypatch)
    monkeypatch.setattr(settings, "site_password", "test-site-password")

    async def scenario():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://localhost"
        ) as http:
            site = await http.get(
                "/api/agent/status", headers={"Authorization": "Bearer test-mcp-key"}
            )
            assert site.status_code == 401
            assert site.headers["www-authenticate"].startswith("Basic")
            for path in ("/mcp/", "/mcp/anything"):
                mcp = await http.post(path, json={})
                assert mcp.status_code == 401
                assert mcp.headers["www-authenticate"] == "Bearer"
            assert (await http.get("/mcpevil")).status_code == 401

    asyncio.run(scenario())


def test_sdk_call_returns_shared_data_sources_and_artifacts(monkeypatch):
    configure(monkeypatch)
    execute = AsyncMock(
        return_value={
            "data": {"rows": [{"value": 12}]},
            "sources": [{"url": "/companies/1"}],
            "artifacts": [{"kind": "bar"}],
            "as_of": "2026-10-05",
            "site_url": "https://site.test",
        }
    )
    monkeypatch.setattr(mcp_server, "execute_tool", execute)

    async def scenario():
        async with client_session() as session:
            result = await session.call_tool("analytics", {"days": 30, "employer_ids": [1]})
            assert not result.isError
            assert result.structuredContent["data"]["rows"][0]["value"] == 12
            assert result.structuredContent["artifacts"][0]["kind"] == "bar"
            assert result.structuredContent["sources"][0]["url"] == "/companies/1"
            assert execute.call_args.args[0] == "analytics"
            assert execute.call_args.args[1]["employer_ids"] == [1]

    asyncio.run(scenario())


def test_sdk_rejects_sql_and_unbounded_parameters(monkeypatch):
    configure(monkeypatch)
    execute = AsyncMock()
    monkeypatch.setattr(mcp_server, "execute_tool", execute)

    async def scenario():
        async with client_session() as session:
            for name, args in (
                ("analytics", {"limit": 1000}),
                ("analytics", {"employer_ids": [-1]}),
                ("company_profile", {"employer_id": 0}),
                ("search_mentions", {"employer_id": 1, "days": 0}),
                ("execute_sql", {"sql": "DROP TABLE vacancy"}),
            ):
                result = await session.call_tool(name, args)
                assert result.isError
            execute.assert_not_called()

    asyncio.run(scenario())


def test_app_can_restart_mcp_lifespan(monkeypatch):
    configure(monkeypatch)

    async def scenario():
        for _ in range(2):
            async with client_session() as session:
                assert len((await session.list_tools()).tools) == 6

    asyncio.run(scenario())


def test_shared_tool_database_error_is_sanitized(monkeypatch):
    configure(monkeypatch)
    monkeypatch.setattr(
        mcp_server.Run,
        "tool",
        AsyncMock(side_effect=SQLAlchemyError("postgresql://private-password@private-host/db")),
    )

    async def scenario():
        async with client_session() as session:
            result = await session.call_tool("overview", {})
            assert result.isError
            assert "Database unavailable" in result.content[0].text
            assert "private-password" not in result.content[0].text

    asyncio.run(scenario())
