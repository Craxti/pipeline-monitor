"""Notification runtime helpers."""

from __future__ import annotations

from typing import Any, Callable


def make_notify_state(notification_state_cls, *, notify_max: int = 200):
    """Create notification state instance."""
    return notification_state_cls(notify_max=notify_max)


def detect_state_changes(notify_state, snapshot, *, append_event) -> None:
    """Apply snapshot changes to notification state."""
    notify_state.apply(snapshot, append_event=append_event)


def append_notify_entries(
    notify_state: Any,
    entries: list[dict[str, Any]],
    *,
    feed_append: Callable[[list[dict[str, Any]]], None] | None = None,
) -> None:
    """Push entries into the in-memory notification ring and optional event feed."""
    if not entries:
        return
    from web.core.notifications import _append_or_group_event

    for ev in entries:
        _append_or_group_event(
            ev=ev,
            notifications=notify_state.notifications,
            append_event=feed_append,
        )
    notify_max = int(getattr(notify_state, "notify_max", 0) or 0)
    if notify_max > 0 and len(notify_state.notifications) > notify_max:
        del notify_state.notifications[: len(notify_state.notifications) - notify_max]
