from __future__ import annotations

from web.core import event_feed as _event_feed_mod


def slim(entry: dict) -> dict:
    return _event_feed_mod.slim_event(entry)


def append(entries: list[dict], *, path, max_entries: int) -> None:
    _event_feed_mod.append_events(entries, path=path, max_entries=max_entries)


def load(*, limit: int, path) -> list[dict]:
    return _event_feed_mod.load_events(limit, path=path)

