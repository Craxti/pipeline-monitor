from __future__ import annotations

from typing import Callable


def api_events_persisted(*, event_feed_load: Callable[[int], list[dict]], limit: int) -> dict:
    lim = max(1, min(limit, 500))
    return {"items": event_feed_load(lim)}

