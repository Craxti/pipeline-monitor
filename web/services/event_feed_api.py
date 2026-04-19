"""Facade for persisted event feed helpers."""

from __future__ import annotations

from web.core import event_feed as _event_feed_mod


def slim(entry: dict) -> dict:
    """Return compact representation for persisted store."""
    return _event_feed_mod.slim_event(entry)


def append(entries: list[dict], *, path=None, max_entries: int) -> None:
    """Append entries to persisted event feed (SQLite by default)."""
    _event_feed_mod.append_events(entries, path=path, max_entries=max_entries)


def load(*, limit: int, path=None) -> list[dict]:
    """Load last N entries from persisted event feed."""
    return _event_feed_mod.load_events(limit, path=path)
