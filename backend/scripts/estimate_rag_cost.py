"""Count actual corpus tokens with read-only DB sessions; no embeddings billed."""

import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault(
    "TIKTOKEN_CACHE_DIR", str(Path(__file__).resolve().parents[1] / ".cache/tiktoken")
)

import tiktoken  # noqa: E402

from app.db import SessionLocal, engine  # noqa: E402
from app.rag_documents import chunks, load_documents  # noqa: E402


async def main():
    async with SessionLocal() as session:
        documents = await load_documents(session)
    encoder = tiktoken.get_encoding("cl100k_base")
    texts = [doc.title + "\n" + chunk for doc in documents for chunk in chunks(doc.body)]
    tokens = sum(len(encoder.encode(value, disallowed_special=())) for value in texts)
    print(
        json.dumps(
            {
                "documents": len(documents),
                "companies": len({doc.employer_id for doc in documents}),
                "chunks": len(texts),
                "tokens": tokens,
                "large_initial_usd": round(tokens / 1_000_000 * 0.13, 6),
                "small_initial_usd": round(tokens / 1_000_000 * 0.02, 6),
                "queries_1000_at_100_tokens_usd": 0.013,
            },
            indent=2,
        )
    )
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
