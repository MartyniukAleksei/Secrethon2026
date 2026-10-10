"""Read-only DB capability check and one harmless embedding API probe."""

import asyncio
import json
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.agent_provider import ProviderError, post_json  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import make_engine  # noqa: E402


async def main():
    engine = make_engine(settings.database_url)
    try:
        async with engine.connect() as connection:
            available = await connection.execute(
                text(
                    "SELECT name, default_version, installed_version "
                    "FROM pg_available_extensions WHERE name = 'vector'"
                )
            )
            print("pgvector:", json.dumps([dict(row) for row in available.mappings()]))
    except Exception as exc:
        print("Database probe failed:", type(exc).__name__)
    finally:
        await engine.dispose()
    base = settings.gpt_base_url.rstrip("/")
    request = Request(base + "/models", headers={"Authorization": "Bearer " + settings.gpt_api_key})
    try:
        with urlopen(request, timeout=30) as response:
            models = json.load(response)
        print(
            "Embedding models:",
            [row["id"] for row in models.get("data", []) if "embed" in row.get("id", "").lower()],
        )
    except (HTTPError, URLError, TimeoutError):
        print("Model listing unavailable")
    try:
        result = await post_json(
            base + "/embeddings",
            {
                "model": "text-embedding-3-small",
                "input": ["Company manufactures equipment."],
                "encoding_format": "float",
            },
            {"Authorization": "Bearer " + settings.gpt_api_key},
            "Embeddings",
        )
        print("Embeddings API: OK; dimensions:", len(result["data"][0]["embedding"]))
    except ProviderError as exc:
        print("Embeddings API unavailable:", exc.status, exc.reason)


if __name__ == "__main__":
    asyncio.run(main())
