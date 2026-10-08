"""Tiny in-process TTL cache for expensive read-only aggregates.

The pipeline loads data in batches, so serving results a few minutes old is fine,
and it turns multi-second aggregate queries into instant responses.
"""

import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Hashable
from typing import Any

TTL_SECONDS = 600


class TTLCache:
    def __init__(self, ttl: float = TTL_SECONDS, maxsize: int = 256) -> None:
        self.ttl = ttl
        self.maxsize = maxsize
        self._items: OrderedDict[Hashable, tuple[float, Any]] = OrderedDict()

    async def get_or_load(self, key: Hashable, load: Callable[[], Awaitable[Any]]) -> Any:
        hit = self._items.get(key)
        now = time.monotonic()
        if hit and now - hit[0] < self.ttl:
            self._items.move_to_end(key)
            return hit[1]
        value = await load()
        self._items[key] = (now, value)
        self._items.move_to_end(key)
        while len(self._items) > self.maxsize:
            self._items.popitem(last=False)
        return value

    def invalidate(self, *keys: Hashable) -> None:
        for key in keys:
            self._items.pop(key, None)

    def clear(self) -> None:
        self._items.clear()


cache = TTLCache()
