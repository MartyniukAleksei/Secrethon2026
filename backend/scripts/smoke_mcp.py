"""Read-only live MCP verification. The mentions call consumes one Tavily search credit."""

import argparse
import asyncio
import sys
from pathlib import Path

import httpx
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamable_http_client

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.config import settings  # noqa: E402


async def verify(read, write):
    async with ClientSession(read, write) as session:
        await session.initialize()
        tools = await session.list_tools()
        assert len(tools.tools) == 6
        print("MCP initialized; tools:", len(tools.tools))
        method = await session.read_resource("secrethon://methodology")
        assert "RUB" in method.contents[0].text
        print("Methodology resource: OK")

        async def call(name, args):
            result = await session.call_tool(name, args)
            if result.isError:
                raise RuntimeError("Tool failed: " + name)
            assert result.structuredContent is not None
            print(name + ": OK")
            return result.structuredContent

        overview = await call("overview", {})
        analytics = await call("analytics", {"group_by": "summary", "days": 0})
        assert analytics["data"]["rows"][0]["value"] == overview["data"]["vpk_vacancies"]
        ranked = await call("analytics", {"group_by": "company", "days": 0, "limit": 2})
        assert {"table", "bar"} <= {a["kind"] for a in ranked["artifacts"]}
        rows = ranked["data"]["rows"]
        if rows:
            ident = rows[0]["id"]
            found = await call("search_employers", {"query": rows[0]["label"][:150]})
            assert any(row["id"] == ident for row in found["data"]["candidates"])
            await call("company_profile", {"employer_id": ident})
            await call("vacancies", {"employer_id": ident, "days": 0, "limit": 2})
            await call("search_mentions", {"employer_id": ident, "days": 7})
        prompt = await session.get_prompt("research_company", {"company": "Тест"})
        assert prompt.messages
        print("Research prompt: OK")


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--transport", choices=["stdio", "http"], default="stdio")
    parser.add_argument("--url", default="http://127.0.0.1:8000/mcp/")
    args = parser.parse_args()
    if args.transport == "stdio":
        params = StdioServerParameters(command=sys.executable, args=[str(BACKEND / "mcp_stdio.py")])
        async with stdio_client(params) as (read, write):
            await verify(read, write)
    else:
        if not settings.mcp_api_key:
            raise RuntimeError("Set MCP_API_KEY in backend/.env before HTTP verification")
        async with httpx.AsyncClient(
            headers={"Authorization": "Bearer " + settings.mcp_api_key},
            timeout=90,
        ) as http:
            async with streamable_http_client(args.url, http_client=http) as (read, write, _):
                await verify(read, write)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        print("Live MCP check failed:", type(exc).__name__)
        sys.exit(1)
