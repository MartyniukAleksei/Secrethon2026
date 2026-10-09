import asyncio
from unittest.mock import AsyncMock, Mock

import pytest

from app import agent_provider as provider


def test_temporary_gemini_failure_retries_only_same_generation(monkeypatch):
    request = Mock(side_effect=[provider.ProviderError("Gemini", 503), {"candidates": []}])
    sleep = AsyncMock()
    monkeypatch.setattr(provider, "_request", request)
    monkeypatch.setattr(provider.asyncio, "sleep", sleep)
    payload = {"contents": [{"text": "test"}]}
    result = asyncio.run(provider.post_json("https://example.test", payload, {}, "Gemini"))
    assert result == {"candidates": []}
    assert request.call_count == 2
    assert request.call_args_list[0] == request.call_args_list[1]
    sleep.assert_awaited_once_with(1)


@pytest.mark.parametrize(
    "name,status,attempts",
    [
        ("Gemini", 400, 1),
        ("Gemini", 401, 1),
        ("Gemini", 403, 1),
        ("Gemini", 404, 1),
        ("Gemini", 429, 1),
        ("Tavily", 503, 1),
        ("Gemini", 503, 3),
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
