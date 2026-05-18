"""Persisted event feed (SQLite ``meta``; optional file path for tests)."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

EVENT_FEED_PATH = Path("data") / "event_feed.json"
EVENT_FEED_MAX = 500


def slim_event(entry: dict[str, Any]) -> dict[str, Any]:
    """Compact record for disk (matches in-app notification shape)."""
    out: dict[str, Any] = {
        "id": entry.get("id"),
        "ts": entry.get("ts"),
        "kind": entry.get("kind"),
        "level": entry.get("level"),
        "title": entry.get("title"),
        "detail": entry.get("detail"),
    }
    if entry.get("url"):
        out["url"] = entry["url"]
    if entry.get("critical"):
        out["critical"] = True
    return out


def append_events(
    entries: list[dict[str, Any]],
    *,
    path: Path | None = None,
    max_entries: int = EVENT_FEED_MAX,
) -> None:
    """Append state-change events (SQLite by default; ``path`` forces JSON file for tests)."""
    if not entries:
        return
    slimmed = [slim_event(e) for e in entries]
    if path is not None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            cur: list[Any] = []
            if path.exists():
                raw = path.read_text(encoding="utf-8").strip()
                if raw:
                    cur = json.loads(raw)
                if not isinstance(cur, list):
                    cur = []
            for e in slimmed:
                cur.append(e)
            if max_entries > 0 and len(cur) > max_entries:
                cur = cur[-max_entries:]
            path.write_text(json.dumps(cur, ensure_ascii=False), encoding="utf-8")
        except Exception as exc:
            logger.warning("event_feed append failed: %s", exc)
        return

    try:
        from web.db import ensure_database_initialized, event_feed_append_slimmed

        if not ensure_database_initialized():
            return
        event_feed_append_slimmed(slimmed, max_entries=max_entries)
    except Exception as exc:
        logger.warning("event_feed append failed: %s", exc)


def load_events(
    limit: int = 300,
    *,
    path: Path | None = None,
) -> list[dict[str, Any]]:
    """Read newest *limit* persisted events (chronological)."""
    if path is not None:
        if not path.exists():
            return []
        try:
            cur = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(cur, list):
                return []
            return cur[-limit:] if limit > 0 else cur  # type: ignore[return-value]
        except Exception as exc:
            logger.debug("event_feed load failed: %s", exc)
            return []

    try:
        from web.db import ensure_database_initialized, event_feed_load_list

        if not ensure_database_initialized():
            return []
        return event_feed_load_list(limit)
    except Exception as exc:
        logger.debug("event_feed load failed: %s", exc)
        return []
