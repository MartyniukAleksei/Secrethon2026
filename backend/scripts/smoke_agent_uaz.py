"""Read-only reproduction of short employer names and scoped vacancy charts."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import rag  # noqa: E402
from app.agent_routing import named_companies  # noqa: E402
from app.api.agent import ChatIn, answer  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402


async def main():
    from app.repository import employers

    async with SessionLocal() as session:
        directory = await employers.list_employers(session)
        matches = named_companies("УАЗ", directory)
        print("UAZ matches:", matches, flush=True)
        assert len(matches) == 1
        ident = matches[0]["id"]
        for question in ("УАЗ", "Графік топ 5 вакансій УАЗ"):
            result = await answer(
                ChatIn(
                    message=question,
                    context={"page": "map", "company_id": 4064, "days": 0},
                    web_access="db_only",
                ),
                session,
            )
            assert result["map_action"] == {"kind": "focus_company", "employer_id": ident}
            if "Графік" in question:
                table = next(item for item in result["artifacts"] if item["kind"] == "table")
                assert 0 < len(table["rows"]) <= 5
                assert all(row["employers"] == 1 for row in table["rows"])
                assert not any(
                    "Алабуга" in row["label"] or "РОСКОСМОС" in row["label"]
                    for row in table["rows"]
                )
                print(
                    "Scoped vacancy rows:",
                    [(row["label"], row["value"]) for row in table["rows"]],
                    flush=True,
                )
            print(question, ":", result["text"], flush=True)
    await engine.dispose()
    await rag.write_engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
