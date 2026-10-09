"""Small server-only JSON clients. Provider errors never expose credentials or URLs."""

import asyncio
import json
import logging
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)


class ProviderError(Exception):
    def __init__(self, provider: str, status: int = 503, reason: str = "http"):
        self.provider = provider
        self.status = status
        self.reason = reason
        super().__init__(f"{provider} unavailable ({status})")


def _request(url: str, payload: dict, headers: dict, provider: str) -> dict:
    request = Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urlopen(request, timeout=45) as response:
            return json.load(response)
    except HTTPError as exc:
        raise ProviderError(provider, exc.code) from None
    except (URLError, TimeoutError, OSError):
        raise ProviderError(provider, reason="connection") from None
    except ValueError:
        raise ProviderError(provider, reason="invalid_json") from None


async def post_json(url: str, payload: dict, headers: dict, provider: str) -> dict:
    # Retry only the failed generation, preserving already collected evidence/tools.
    # Tavily requests are not retried to avoid spending extra search credits.
    attempts = 3 if provider == "Gemini" else 1
    for attempt in range(attempts):
        try:
            return await asyncio.to_thread(_request, url, payload, headers, provider)
        except ProviderError as exc:
            if exc.status not in (500, 502, 503, 504) or attempt + 1 == attempts:
                raise
            logger.warning(
                "%s retry %s: status=%s reason=%s",
                provider,
                attempt + 1,
                exc.status,
                exc.reason,
            )
            await asyncio.sleep(2**attempt)
    raise AssertionError("Unreachable")
