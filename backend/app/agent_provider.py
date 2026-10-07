"""Small server-only JSON clients. Provider errors never expose credentials or URLs."""

import asyncio
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class ProviderError(Exception):
    def __init__(self, provider: str, status: int = 503):
        self.provider = provider
        self.status = status
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
    except (URLError, TimeoutError, OSError, ValueError):
        raise ProviderError(provider) from None


async def post_json(url: str, payload: dict, headers: dict, provider: str) -> dict:
    return await asyncio.to_thread(_request, url, payload, headers, provider)
