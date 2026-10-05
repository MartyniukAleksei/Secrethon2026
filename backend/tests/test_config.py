import pytest
from pydantic import ValidationError

from app.config import Settings


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://u:p@host:5432/db",
        "postgres://u:p@host:5432/db",
        "postgresql+asyncpg://u:p@host:5432/db",
        '  "postgresql://u:p@host:5432/db"\n',
    ],
)
def test_database_url_normalized(url: str) -> None:
    assert Settings(database_url=url).database_url == "postgresql+asyncpg://u:p@host:5432/db"


@pytest.mark.parametrize(
    "url",
    ["", "${{Postgres.DATABASE_URL}}", "jdbc:postgresql://host:5432/db", "mysql://u:p@h/db"],
)
def test_database_url_invalid(url: str) -> None:
    with pytest.raises(ValidationError, match="DATABASE_URL must look like"):
        Settings(database_url=url)


def test_database_url_error_hides_password() -> None:
    with pytest.raises(ValidationError) as exc:
        Settings(database_url="jdbc:postgresql://u:secret@host:5432/db")
    assert "secret" not in str(exc.value)
