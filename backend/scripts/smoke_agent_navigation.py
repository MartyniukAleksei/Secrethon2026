"""Live identity/navigation check; all database transactions are explicitly read-only."""

import asyncio
import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agent_provider import ProviderError  # noqa: E402
from app.api import agent  # noqa: E402
from app.api.agent import ChatIn, Context, Run, answer  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402


async def main():
    if "--diagnostics" in sys.argv:
        original_post = agent.post_json

        async def diagnostic_post(url, payload, headers, provider):
            response = await original_post(url, payload, headers, provider)
            if provider == "Gemini":
                for candidate in response.get("candidates", []):
                    calls = [
                        (p["functionCall"].get("name"), bool(p["functionCall"].get("id")))
                        for p in candidate.get("content", {}).get("parts", [])
                        if "functionCall" in p
                    ]
                    print(
                        "Gemini diagnostic:",
                        candidate.get("finishReason"),
                        "calls (name, has ID):",
                        calls,
                        flush=True,
                    )
            return response

        agent.post_json = diagnostic_post
    try:
        async with SessionLocal() as session:
            await session.execute(text("SET TRANSACTION READ ONLY"))
            await session.execute(text("SET LOCAL statement_timeout = '30s'"))
            found = await Run(session, Context()).tool(
                "search_employers", {"query": "Алабуга політех"}
            )
            assert len(found["candidates"]) == 1
            company = found["candidates"][0]
            assert "association" in company["matched_in"]
            print("Database description association: OK; card", company["id"], flush=True)
            if "--relations-only" not in sys.argv:
                first = await answer(
                    ChatIn(
                        message="Розкажи коротко про Алабугу Політех і наблизь на карті.",
                        context=Context(page="map", days=0),
                    ),
                    session,
                )
                assert first["map_action"] == {
                    "kind": "focus_company",
                    "employer_id": company["id"],
                }
                print("Live Gemini: named company -> verified map zoom: OK", flush=True)
            second = await answer(
                ChatIn(
                    message="Покажи звязки алабуги",
                    context=Context(page="map", company_id=company["id"], days=0),
                    web_access="db_only",
                ),
                session,
            )
            assert second["map_action"] == {"kind": "show_relations", "employer_id": company["id"]}
            print("Live Gemini: relationships -> requested company network: OK", flush=True)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except ProviderError as exc:
        print("Live navigation provider failed:", exc.provider, exc.status, flush=True)
        sys.exit(1)
    except Exception as exc:
        print("Live navigation check failed:", type(exc).__name__, flush=True)
        sys.exit(1)
