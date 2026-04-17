from __future__ import annotations


def make_notify_state(NotificationStateCls, *, notify_max: int = 200):
    return NotificationStateCls(notify_max=notify_max)


def detect_state_changes(notify_state, snapshot, *, append_event) -> None:
    notify_state.apply(snapshot, append_event=append_event)

