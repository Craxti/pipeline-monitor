"""API endpoints for notifications feed."""

from __future__ import annotations

from typing import Any


def api_notifications(*, notify_state: Any, since_id: int, limit: int) -> dict:
    """Return notifications since the given id."""
    items = [n for n in notify_state.notifications if n["id"] > since_id]
    return {
        "items": items[-limit:],
        "total": len(items),
        "max_id": notify_state.notify_id_seq,
    }
