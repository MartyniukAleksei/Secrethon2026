from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import Settings


def test_default_env_files_are_absolute_and_backend_has_priority() -> None:
    root = Path(__file__).resolve().parents[2]
    assert Settings.model_config["env_file"] == (root / ".env", root / "backend" / ".env")


def test_env_files_load_shared_credentials_and_backend_overrides(tmp_path, monkeypatch) -> None:
    for name in ("GEMINI_API_KEY", "TAVILY_API_KEY", "MCP_API_KEY", "AGENT_ENABLED"):
        monkeypatch.delenv(name, raising=False)
    root_env = tmp_path / ".env"
    backend_env = tmp_path / "backend.env"
    root_env.write_text(
        "GEMINI_API_KEY=test-gemini\nTAVILY_API_KEY=test-tavily\n"
        "MCP_API_KEY=test-mcp\nAGENT_ENABLED=true\n",
        encoding="utf-8",
    )
    backend_env.write_text("AGENT_ENABLED=false\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path.parent)
    configured = Settings(_env_file=(root_env, backend_env))
    assert configured.gemini_api_key == "test-gemini"
    assert configured.tavily_api_key == "test-tavily"
    assert configured.mcp_api_key == "test-mcp"
    assert configured.agent_enabled is False

    monkeypatch.setenv("GEMINI_API_KEY", "environment-gemini")
    monkeypatch.setenv("AGENT_ENABLED", "true")
    configured = Settings(_env_file=(root_env, backend_env))
    assert configured.gemini_api_key == "environment-gemini"
    assert configured.agent_enabled is True


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
