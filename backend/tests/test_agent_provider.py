import asyncio
import io
import json
from unittest.mock import AsyncMock, Mock
from urllib.error import HTTPError

import pytest

from app import agent_provider as provider


def test_temporary_gpt_failure_retries_only_same_generation(monkeypatch):
    request = Mock(side_effect=[provider.ProviderError("GPT", 503), {"choices": []}])
    sleep = AsyncMock()
    monkeypatch.setattr(provider, "_request", request)
    monkeypatch.setattr(provider.asyncio, "sleep", sleep)
    payload = {"messages": [{"role": "user", "content": "test"}]}
    result = asyncio.run(provider.post_json("https://example.test", payload, {}, "GPT"))
    assert result == {"choices": []}
    assert request.call_count == 2
    assert request.call_args_list[0] == request.call_args_list[1]
    sleep.assert_awaited_once_with(1)


@pytest.mark.parametrize(
    "name,status,attempts",
    [
        ("GPT", 400, 1),
        ("GPT", 401, 1),
        ("GPT", 403, 1),
        ("GPT", 404, 1),
        ("GPT", 429, 1),
        ("Tavily", 503, 1),
        ("GPT", 503, 3),
    ],
)
def test_retries_are_bounded_and_skip_permanent_errors_and_searches(
    monkeypatch, name, status, attempts
):
    request = Mock(side_effect=provider.ProviderError(name, status))
    sleep = AsyncMock()
    monkeypatch.setattr(provider, "_request", request)
    monkeypatch.setattr(provider.asyncio, "sleep", sleep)
    with pytest.raises(provider.ProviderError):
        asyncio.run(provider.post_json("https://example.test", {}, {}, name))
    assert request.call_count == attempts
    assert sleep.await_count == attempts - 1


def test_rejected_request_logs_reason_without_credentials_or_urls(monkeypatch, caplog):
    error = HTTPError(
        "https://example.test",
        400,
        "Bad Request",
        {},
        io.BytesIO(
            json.dumps(
                {
                    "error": {
                        "message": "Input exceeds conservative input limit. "
                        "Bearer private-token at https://example.test/private"
                    }
                }
            ).encode()
        ),
    )
    monkeypatch.setattr(provider, "urlopen", Mock(side_effect=error))
    with pytest.raises(provider.ProviderError):
        provider._request(
            "https://example.test", {}, {"Authorization": "Bearer private-token"}, "GPT"
        )
    assert "Input exceeds conservative input limit" in caplog.text
    assert "private-token" not in caplog.text
    assert "https://" not in caplog.text
