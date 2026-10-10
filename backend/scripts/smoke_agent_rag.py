"""Read-only live smoke: relevant passages and company switching with GPT."""

import asyncio
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import rag  # noqa: E402
from app.api.agent import ChatIn, answer  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402


async def main():
    question = "Що виробляє Калашников?"
    async with SessionLocal() as session:
        values = await rag.retrieve(session, question, 4653)
        if not values:
            raise SystemExit("No indexed passages for employer 4653 yet")
        assert all(row["employer_id"] == 4653 for row in values)
        print(f"Retrieved passages: {len(values)}", flush=True)
        result = await answer(ChatIn(message=question,
                                    context={"page": "map", "company_id": 4064}), session)
    assert result["map_action"]["employer_id"] == 4653
    assert not result.get("web_permission")
    assert result["sources"]
    Path(".cache/rag").mkdir(parents=True, exist_ok=True)
    Path(".cache/rag/smoke-answer.json").write_text(
        json.dumps(result, default=str, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    substantive = "\n".join([result["text"], *(s["text"] for s in result.get("sections", []))])
    assert re.search(r"збро|бпла|катер|снаряд|боєприпас", substantive, re.I), (
        "Answer must name actual products, not merely state that a record exists"
    )
    print("GPT answer, citations and switch from Alabuga to Kalashnikov: OK", flush=True)
    await engine.dispose()
    await rag.write_engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
