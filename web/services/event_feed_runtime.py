"""Runtime container for persisted event feed configuration."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class EventFeedRuntime:
    """Event feed path + max entries settings."""
    path: str
    max_entries: int


def slim(event_feed_api_mod, entry: dict) -> dict:
    """Return compact event representation."""
    return event_feed_api_mod.slim(entry)


def append(event_feed_api_mod, rt: EventFeedRuntime, entries: list[dict]) -> None:
    """Append events to persisted feed."""
    return event_feed_api_mod.append(entries, path=rt.path, max_entries=rt.max_entries)


def load(event_feed_api_mod, rt: EventFeedRuntime, limit: int = 300) -> list[dict]:
    """Load last events from persisted feed."""
    return event_feed_api_mod.load(limit=limit, path=rt.path)
