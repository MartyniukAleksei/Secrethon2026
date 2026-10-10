"""Explicit RAG setup/indexing. No migrations or pipeline writes."""

import argparse
import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import rag  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402
from app.rag_documents import load_documents  # noqa: E402


async def main(apply: bool):
    async with SessionLocal() as session:
        documents = await load_documents(session)
        previous = await rag.fingerprints(session)
    changed = sum(previous.get(doc.key) != doc.fingerprint for doc in documents)
    print(f"Documents: {len(documents)}; changed: {changed}", flush=True)
    if apply:
        await rag.initialize()
        indexed = await rag.index_documents(documents, previous)
        await rag.finalize_index(documents, previous)
        print(f"Indexed documents: {indexed}", flush=True)
    else:
        print("Dry run; use --apply to initialize pgvector and index changed documents.")
    await engine.dispose()
    await rag.write_engine.dispose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    asyncio.run(main(parser.parse_args().apply))
