"""Simple in-memory TTL cache helpers."""

from __future__ import annotations

import time
from typing import Any


def mem_cache_get(store: dict[str, tuple[float, Any]], key: str) -> Any | None:
    """Return cached value if present and not expired."""
    ent = store.get(key)
    if not ent:
        return None
    exp, val = ent
    if time.monotonic() > exp:
        del store[key]
        return None
    return val


def mem_cache_set(
    store: dict[str, tuple[float, Any]],
    key: str,
    val: Any,
    *,
    ttl_seconds: float,
) -> None:
    """Set a cached value with TTL in seconds."""
    store[key] = (time.monotonic() + ttl_seconds, val)
