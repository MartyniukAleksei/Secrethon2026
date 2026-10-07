import asyncio
import os
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlsplit

import pytest

# Tests rebuild the database from scratch, so they must never touch a shared one.
# They use TEST_DATABASE_URL (default: the docker-compose Postgres) and refuse non-local hosts.
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/secrethon_test"
)
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
host = urlsplit(TEST_DATABASE_URL).hostname
if host not in LOCAL_HOSTS:
    raise pytest.UsageError(
        f"Tests reset the database; refusing to run against non-local host {host!r}"
    )

# The app reads DATABASE_URL at import time; point it at the test database first.
os.environ["DATABASE_URL"] = TEST_DATABASE_URL

import asyncpg  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.repository.cache import cache  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


async def _reset_database() -> None:
    url = TEST_DATABASE_URL
    admin = await asyncpg.connect(url.rsplit("/", 1)[0] + "/postgres")
    try:
        name = urlsplit(url).path.lstrip("/")
        exists = await admin.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", name)
        if not exists:
            await admin.execute(f'CREATE DATABASE "{name}"')
    finally:
        await admin.close()
    conn = await asyncpg.connect(url)
    try:
        await conn.execute(
            "DROP SCHEMA IF EXISTS web_reviews CASCADE; "
            "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
        )
        await conn.execute((ROOT / "db" / "schema.sql").read_text(encoding="utf-8"))
        await conn.execute("SET search_path = public")
        await conn.execute((ROOT / "tests" / "fixtures" / "sample.sql").read_text(encoding="utf-8"))
    finally:
        await conn.close()


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    asyncio.run(_reset_database())
    cache.clear()
    # One client for the whole session keeps a single event loop for the connection pool.
    with TestClient(app) as test_client:
        yield test_client
