"""Read-only real-data checks for Ukrainian answers and hiring-place navigation."""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import rag  # noqa: E402
from app.agent_language import russian_prose  # noqa: E402
from app.agent_routing import named_companies  # noqa: E402
from app.api.agent import ChatIn, Context, Run, answer  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402
from app.repository import employers  # noqa: E402


async def main():
    async with SessionLocal() as session:
        if "--vacancy-tools" in sys.argv:
            candidates = named_companies("НПО Алмаз", await employers.list_employers(session))
            print("Candidates:", json.dumps(candidates, ensure_ascii=True), flush=True)
            assert candidates
            assert len(candidates) == 1
            ident = candidates[0]["id"]
            run = Run(session, Context(page="map", company_id=ident, days=0))
            result = await run.tool(
                "vacancies", {"employer_id": ident, "query": "диспетчер", "limit": 10, "days": 0}
            )
            print(json.dumps(result, default=str, ensure_ascii=True), flush=True)
            await engine.dispose()
            await rag.write_engine.dispose()
            return
        questions = [
            "Чи треба в НПО Алмаз диспетчер?",
            "Покажи декілька місць найму УАЗ на карті",
            "Покажи місця найму УАЗ і Калашникова на карті",
        ]
        if "--dispatcher-only" in sys.argv:
            questions = questions[:1]
        for question in questions:
            result = await answer(
                ChatIn(
                    message=question,
                    context={"page": "map", "company_id": 4064, "days": 0},
                    web_access="db_only",
                ),
                session,
            )
            assert not russian_prose(
                result["text"], [source["title"] for source in result["sources"]]
            )
            if "місця" in question or "місць" in question:
                action = result["map_action"]
                assert action["kind"] == "show_hiring_places"
                assert len(action["places"]) > 1
                if "Калашникова" in question:
                    assert len(action["employer_ids"]) == 2
                print(
                    "Hiring places:",
                    len(action["places"]),
                    "employers:",
                    action["employer_ids"],
                    flush=True,
                )
            print("Ukrainian response:", result["text"], flush=True)
    await engine.dispose()
    await rag.write_engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
