from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class EventFeedRuntime:
    path: str
    max_entries: int


def slim(event_feed_api_mod, entry: dict) -> dict:
    return event_feed_api_mod.slim(entry)


def append(event_feed_api_mod, rt: EventFeedRuntime, entries: list[dict]) -> None:
    return event_feed_api_mod.append(entries, path=rt.path, max_entries=rt.max_entries)


def load(event_feed_api_mod, rt: EventFeedRuntime, limit: int = 300) -> list[dict]:
    return event_feed_api_mod.load(limit=limit, path=rt.path)

