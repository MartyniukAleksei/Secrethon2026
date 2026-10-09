"""Live map-agent check; every database transaction is explicitly read-only."""

import asyncio
import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agent_scope import Bounds, MapScope  # noqa: E402
from app.api.agent import ChatIn, Context, Run, answer  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402
from app.repository.employers import map_points  # noqa: E402


async def main():
    try:
        async with SessionLocal() as session:
            await session.execute(text("SET TRANSACTION READ ONLY"))
            await session.execute(text("SET LOCAL statement_timeout = '30s'"))
            points = await map_points(session)
            assert points
            point = points[0]
            bounds = Bounds(
                west=max(-180, point["lng"] - 2),
                east=min(180, point["lng"] + 2),
                south=max(-85, point["lat"] - 2),
                north=min(85, point["lat"] + 2),
            )
            context = Context(days=0, map_scope=MapScope(mode="viewport", bounds=bounds))
            run = Run(session, context, web_access="allowed")
            data = await run.tool("analytics", {"group_by": "company", "limit": 3})
            assert data["scope"]["map_scope"]["bounds"] == bounds.model_dump()
            assert data["scope"]["totals"]["employers"] >= len(data["rows"])
            print("Read-only viewport analytics: OK")
            await run.tool("company_profile", {"employer_id": point["employer_id"]})
            mentions = await run.tool(
                "search_mentions", {"employer_id": point["employer_id"], "days": 7}
            )
            assert "error" not in mentions
            for item in mentions["items"]:
                source = run.sources[item["source_id"]]
                assert source["origin"] == "public_web" and source["verification"] == "unverified"
                assert source["retrieved_at"] and source["excerpt"] == item["text"]
            print("Live company profile and Tavily evidence metadata: OK")
            result = await answer(
                ChatIn(
                    message=(
                        "Підсумуй цю область карти та покажи топ-3 "
                        "за кількістю вакансій із джерелами."
                    ),
                    context=context,
                ),
                session,
            )
            assert result["sections"] and result["scope_totals"]
            assert result["context"]["map_scope"]["bounds"] == bounds.model_dump()
            assert result["actions"]
            print("Live Gemini viewport answer, sections, evidence and map actions: OK")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        print("Live map check failed:", type(exc).__name__)
        sys.exit(1)
