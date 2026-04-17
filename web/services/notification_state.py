"""State container for change notifications.

Wraps ``web.core.notifications.detect_state_changes`` so ``web.app`` can keep a
single object instead of multiple module-level globals.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, List, Tuple

from models.models import CISnapshot
from web.core.notifications import detect_state_changes as _detect


EventAppender = Callable[[List[dict]], None]


@dataclass
class NotificationState:
    """Holds prior state and notification ring buffer for change detection."""
    notify_max: int = 200
    notifications: List[dict] = field(default_factory=list)  # ring buffer, newest last
    prev_build_statuses: dict[str, str] = field(default_factory=dict)
    prev_svc_statuses: dict[str, str] = field(default_factory=dict)
    prev_incident_active: bool = False
    prev_incident_sig: Tuple[int, int, int, bool] = (0, 0, 0, False)
    notify_id_seq: int = 0

    def apply(self, snapshot: CISnapshot, *, append_event: EventAppender | None = None) -> None:
        """Run state change detection and update internal caches."""
        (
            self.prev_build_statuses,
            self.prev_svc_statuses,
            self.prev_incident_active,
            self.prev_incident_sig,
            self.notify_id_seq,
        ) = _detect(
            snapshot,
            prev_build_statuses=self.prev_build_statuses,
            prev_svc_statuses=self.prev_svc_statuses,
            prev_incident_active=self.prev_incident_active,
            prev_incident_sig=self.prev_incident_sig,
            notify_id_seq=self.notify_id_seq,
            notifications=self.notifications,
            notify_max=self.notify_max,
            append_event=append_event,
        )
