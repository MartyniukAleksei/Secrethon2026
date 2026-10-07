"""Read-only live verification. Run from backend: .venv/Scripts/python scripts/smoke_agent.py.

Makes real Gemini/Tavily calls (uses API quota); never logs secrets or company data.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.agent import ChatIn, Context, Run, answer  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402
from app.repository import agent as queries  # noqa: E402
from app.repository import (
    employers,  # noqa: E402
    stats,
)
from app.repository.vacancies import VacancyFilter  # noqa: E402


async def main():
    try:
        async with SessionLocal() as session:
            overview = await stats.overview(session)
            summary = await queries.analytics(session, VacancyFilter(), "summary", "vacancies")
            assert summary["rows"][0]["value"] == overview["vpk_vacancies"]
            salary = await queries.analytics(session, VacancyFilter(), "summary", "median_salary")
            assert salary["rows"][0]["value"] == overview["median_salary"]
            for group in ("region", "category", "month"):
                await queries.analytics(session, VacancyFilter(days=30), group, "vacancies")
            sanctioned = await queries.analytics(
                session, VacancyFilter(), "company", "vacancies", only_sanctioned=True
            )
            assert all(row["sanctions_count"] > 0 for row in sanctioned["rows"])
            print("SQL analytics: OK; totals and median match platform API")
            result = await answer(
                ChatIn(
                    message="Покажи три підприємства з найбільшою кількістю вакансій за 30 днів. "
                    "Додай таблицю і графік, вкажи дату зрізу та джерела.",
                    context=Context(days=30),
                ),
                session,
            )
            print("Agent response: OK")
            print("Tools:", ", ".join(result["tools_used"]))
            print("Artifacts:", ", ".join(a["kind"] for a in result["artifacts"]))
            print("Sources:", len(result["sources"]))
            assert {"table", "bar"} <= {a["kind"] for a in result["artifacts"]}
            assert result["sources"]
            rows = await employers.list_employers(session)
            if rows:
                run = Run(session, Context())
                profile = await run.tool("company_profile", {"employer_id": rows[0]["id"]})
                assert profile["profile"]["id"] == rows[0]["id"]
                assert run.artifacts[profile["artifact_ids"][0]]["kind"] == "relations"
                print("Company profile and relation diagram: OK")
                mentions = await run.tool("search_mentions", {"employer_id": rows[0]["id"]})
                assert "error" not in mentions
                print("Company mentions: OK; results:", len(mentions["items"]))
    except Exception as exc:
        # Avoid SQL exceptions that can embed database connection details.
        print("Live check failed:", type(exc).__name__)
        if hasattr(exc, "status"):
            print("Provider HTTP status:", exc.status)
        sys.exit(1)
    finally:
        await engine.dispose()


asyncio.run(main())
