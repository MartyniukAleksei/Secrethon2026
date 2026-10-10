"""Incremental pgvector index in an app-owned schema; no pipeline mutations."""

import asyncio
import hashlib
import json
import logging

from sqlalchemy import text

from app.config import settings
from app.embeddings import embed, model_key
from app.rag_documents import Document, chunks, research_documents
from app.reviews import engine as write_engine

logger = logging.getLogger(__name__)


def vector_literal(value: list[float]) -> str:
    return "[" + ",".join(str(v) for v in value) + "]"


async def ready(session) -> bool:
    return bool(await session.scalar(text("SELECT to_regclass('agent_knowledge.chunk')")))


async def initialize():
    # Run explicitly from the indexing CLI, never during reads or app startup.
    statements = [
        "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public",
        "CREATE SCHEMA IF NOT EXISTS agent_knowledge",
        """CREATE TABLE IF NOT EXISTS agent_knowledge.document (
            key text NOT NULL, model text NOT NULL, fingerprint text NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (key, model))""",
        """CREATE TABLE IF NOT EXISTS agent_knowledge.chunk (
            document_key text NOT NULL, model text NOT NULL, position integer NOT NULL,
            employer_id bigint, title text NOT NULL, body text NOT NULL, url text NOT NULL,
            origin text NOT NULL CHECK (origin IN ('database', 'public_web')),
            verification text NOT NULL CHECK
                (verification IN ('database_record', 'user_verified', 'unverified')),
            metadata jsonb NOT NULL, embedding public.vector NOT NULL,
            PRIMARY KEY (document_key, model, position),
            FOREIGN KEY (document_key, model) REFERENCES agent_knowledge.document(key, model)
                ON DELETE CASCADE)""",
        "CREATE INDEX IF NOT EXISTS knowledge_employer "
        "ON agent_knowledge.chunk(model, employer_id)",
    ]
    async with write_engine.begin() as conn:
        await conn.execute(text("SELECT pg_advisory_xact_lock(721035)"))
        for statement in statements:
            await conn.execute(text(statement))


async def fingerprints(session) -> dict[str, str]:
    if not await ready(session):
        return {}
    rows = await session.execute(
        text("SELECT key, fingerprint FROM agent_knowledge.document WHERE model = :model"),
        {"model": model_key()},
    )
    return dict(rows.all())


async def finalize_index(documents: list[Document], previous: dict):
    """Prune obsolete snapshot keys only, preserving concurrent new approvals."""
    stale = sorted(set(previous) - {doc.key for doc in documents})
    async with write_engine.begin() as conn:
        await conn.execute(text("SELECT pg_advisory_xact_lock(721035)"))
        if stale:
            await conn.execute(
                text(
                    "DELETE FROM agent_knowledge.document WHERE model = :model AND key = ANY(:keys)"
                ),
                {"model": model_key(), "keys": stale},
            )
    # The index name and type are validated/generated, and the model literal is
    # escaped independently. No credentials or user input enters this DDL.
    name = "knowledge_vector_" + hashlib.sha256(model_key().encode()).hexdigest()[:16]
    model = model_key().replace("'", "''")
    dimensions = int(settings.rag_dimensions)
    async with write_engine.begin() as conn:
        await conn.execute(text("SET LOCAL statement_timeout = '120s'"))
        # Railway containers may have only 64 MB /dev/shm. Parallel HNSW builds
        # exceed it; a single maintenance process uses regular private memory.
        await conn.execute(text("SET LOCAL max_parallel_maintenance_workers = 0"))
        await conn.execute(text("SET LOCAL maintenance_work_mem = '64MB'"))
        await conn.execute(
            text(
                f"CREATE INDEX IF NOT EXISTS {name} ON agent_knowledge.chunk "
                f"USING hnsw ((embedding::public.vector({dimensions})) public.vector_cosine_ops) "
                f"WHERE model = '{model}'"
            )
        )


async def index_documents(documents: list[Document], previous: dict | None = None) -> int:
    """Replace each changed document atomically, only after embeddings succeed."""
    if previous is None:
        async with write_engine.connect() as conn:
            previous = await fingerprints(conn)
    changed = [doc for doc in documents if previous.get(doc.key) != doc.fingerprint]
    # Bounded batches avoid per-document API requests and allow safe restarts.
    batch, parts = [], []
    count = 0

    async def flush():
        nonlocal count
        if not batch:
            return
        inputs = [doc.title + "\n" + body for doc, _, body in parts]
        groups = await asyncio.gather(
            *(embed(inputs[start : start + 32]) for start in range(0, len(inputs), 32))
        )
        vectors = [vector for group in groups for vector in group]
        async with write_engine.begin() as conn:
            await conn.execute(text("SELECT pg_advisory_xact_lock(721035)"))
            document_values = [
                {"key": doc.key, "model": model_key(), "fingerprint": doc.fingerprint}
                for doc in batch
            ]
            await conn.execute(
                text("""
                    INSERT INTO agent_knowledge.document(key, model, fingerprint)
                    VALUES (:key, :model, :fingerprint)
                    ON CONFLICT (key, model) DO UPDATE
                    SET fingerprint = EXCLUDED.fingerprint, updated_at = now()
                """),
                document_values,
            )
            await conn.execute(
                text("""
                    DELETE FROM agent_knowledge.chunk
                    WHERE document_key = :key AND model = :model
                """),
                [{"key": doc.key, "model": model_key()} for doc in batch],
            )
            values = [
                {
                    "key": doc.key,
                    "model": model_key(),
                    "position": position,
                    "employer": doc.employer_id,
                    "title": doc.title,
                    "body": body,
                    "url": doc.url,
                    "origin": doc.origin,
                    "verification": doc.verification,
                    "metadata": json.dumps(doc.metadata, default=str, ensure_ascii=False),
                    "embedding": vector_literal(vector),
                }
                for (doc, position, body), vector in zip(parts, vectors, strict=True)
            ]
            await conn.execute(
                text("""
                INSERT INTO agent_knowledge.chunk
                    (document_key, model, position, employer_id, title, body, url,
                     origin, verification, metadata, embedding)
                VALUES (:key, :model, :position, :employer, :title, :body, :url,
                        :origin, :verification, CAST(:metadata AS jsonb),
                        CAST(:embedding AS public.vector))
            """),
                values,
            )
        count += len(batch)
        logger.info("RAG indexed changed documents: %s/%s", count, len(changed))
        batch.clear()
        parts.clear()

    for doc in changed:
        doc_parts = list(enumerate(chunks(doc.body)))
        if not doc_parts:
            continue
        if len(doc_parts) > 32:
            raise ValueError("Document exceeds embedding batch capacity")
        if len(parts) + len(doc_parts) > 128:
            await flush()
        batch.append(doc)
        parts.extend((doc, position, body) for position, body in doc_parts)
    await flush()
    return count


async def retrieve(session, query: str, employer_id: int | None = None) -> list[dict]:
    if not settings.rag_enabled or not query.strip() or not await ready(session):
        return []
    # No paid query when this provider/model has not been indexed yet.
    if not await session.scalar(
        text("SELECT EXISTS(SELECT 1 FROM agent_knowledge.document WHERE model = :model)"),
        {"model": model_key()},
    ):
        return []
    vector = (await embed([query[:4000]], query=True))[0]
    threshold = settings.rag_min_similarity
    if threshold is None:
        threshold = 0.70 if settings.rag_provider == "local" else 0.25
    # Exact distance within an employer avoids approximate-index post-filter
    # omissions. Global search can use the dimension-specific HNSW expression.
    vector_column = "embedding" if employer_id else (
        f"embedding::public.vector({int(settings.rag_dimensions)})"
    )
    rows = await session.execute(
        text(f"""
        SELECT employer_id, title, body, url, origin, verification, metadata,
               1 - ({vector_column} <=> CAST(:vector AS public.vector)) AS similarity
        FROM agent_knowledge.chunk
        WHERE model = :model
          AND (CAST(:employer AS bigint) IS NULL OR employer_id = :employer)
        ORDER BY {vector_column} <=> CAST(:vector AS public.vector) LIMIT :limit
    """),
        {
            "vector": vector_literal(vector),
            "model": model_key(),
            "employer": employer_id,
            "limit": settings.rag_top_k,
        },
    )
    return [dict(row) for row in rows.mappings() if row["similarity"] >= threshold]


async def index_approved(record: dict):
    # The original approval is durable even if its optional index refresh fails.
    if not settings.rag_enabled:
        return
    try:
        async with write_engine.connect() as conn:
            if not await ready(conn):
                return
        await index_documents(research_documents(record))
    except Exception:
        logger.warning("Approved research saved; RAG refresh unavailable (retry indexing CLI)")
