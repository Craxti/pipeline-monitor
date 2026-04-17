from __future__ import annotations

import time

from fastapi import HTTPException


def check_rate_limit(store: dict[str, float], key: str, *, window: float) -> None:
    """Raise 429 if the same action key was invoked within *window* seconds."""
    now = time.monotonic()
    last = store.get(key, 0.0)
    if now - last < window:
        wait = window - (now - last)
        raise HTTPException(429, f"Rate limit: try again in {wait:.1f}s")
    store[key] = now

