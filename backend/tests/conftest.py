from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import app


# Tests run against a real Postgres from DATABASE_URL with migrations applied
# (`uv run alembic upgrade head`). One client for the whole session keeps a single
# event loop, which the async connection pool is bound to.
@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client
