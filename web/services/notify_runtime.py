"""Notification runtime helpers."""

from __future__ import annotations


def make_notify_state(notification_state_cls, *, notify_max: int = 200):
    """Create notification state instance."""
    return notification_state_cls(notify_max=notify_max)


def detect_state_changes(notify_state, snapshot, *, append_event) -> None:
    """Apply snapshot changes to notification state."""
    notify_state.apply(snapshot, append_event=append_event)
