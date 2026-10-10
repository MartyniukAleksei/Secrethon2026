"""Small server-only JSON clients. Provider errors never expose credentials or URLs."""

import asyncio
import json
import logging
import re
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
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    logger.info("%s request: bytes=%s", provider, len(encoded))
    request = Request(
        url,
        data=encoded,
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urlopen(request, timeout=45) as response:
            return json.load(response)
    except HTTPError as exc:
        # Log only the provider's bounded error description, never request data,
        # credentials or URLs. This makes rejected multi-round requests diagnosable.
        try:
            error = json.loads(exc.read(16000)).get("error", {})
            description = str(error.get("message", "")) if isinstance(error, dict) else ""
        except (ValueError, OSError, AttributeError):
            description = ""
        for value in headers.values():
            if value:
                description = description.replace(value, "[redacted]")
                description = description.replace(value.removeprefix("Bearer "), "[redacted]")
        description = re.sub(r"https?://[^\s\"<>]+", "[url]", description)
        description = re.sub(r"[A-Za-z0-9_\-]{32,}", "[redacted]", description)
        logger.warning(
            "%s rejected request: status=%s detail=%s", provider, exc.code, description[:1500]
        )
        raise ProviderError(provider, exc.code) from None
    except (URLError, TimeoutError, OSError):
        raise ProviderError(provider, reason="connection") from None
    except ValueError:
        raise ProviderError(provider, reason="invalid_json") from None


async def post_json(url: str, payload: dict, headers: dict, provider: str) -> dict:
    # Retry only the failed generation, preserving already collected evidence/tools.
    # Tavily requests are not retried to avoid spending extra search credits.
    attempts = 3 if provider in {"GPT", "Gemini", "Embeddings"} else 1
    for attempt in range(attempts):
        try:
            return await asyncio.to_thread(_request, url, payload, headers, provider)
        except ProviderError as exc:
            retryable = exc.status in (500, 502, 503, 504) or (
                provider == "Embeddings" and exc.status == 429
            )
            if not retryable or attempt + 1 == attempts:
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
