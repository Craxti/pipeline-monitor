"""Correlation computations for dashboard metadata."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from models.models import CISnapshot


def correlation_last_hour(
    *,
    load_snapshot: Callable[[], Optional[CISnapshot]],
    load_events: Callable[[int], list[dict[str, Any]]],
    events_limit: int = 500,
) -> dict[str, int]:
    """Build counts + service state-change events in the last hour (from event_feed)."""
    now = datetime.now(tz=timezone.utc)
    cutoff = now - timedelta(hours=1)

    n_builds = 0
    snap = load_snapshot()
    if snap:
        for b in snap.builds:
            if not getattr(b, "started_at", None):
                continue
            st = b.started_at
            if st.tzinfo is None:
                st = st.replace(tzinfo=timezone.utc)
            else:
                st = st.astimezone(timezone.utc)
            if st >= cutoff:
                n_builds += 1

    n_svc_events = 0
    for e in load_events(int(events_limit)):
        ts_raw = e.get("ts")
        if not ts_raw:
            continue
        try:
            et = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
            if et.tzinfo is None:
                et = et.replace(tzinfo=timezone.utc)
            else:
                et = et.astimezone(timezone.utc)
        except Exception:
            continue
        if et < cutoff:
            continue
        k = str(e.get("kind") or "")
        if k.startswith("svc_"):
            n_svc_events += 1

    return {
        "pipelines_started_last_hour": n_builds,
        "service_events_last_hour": n_svc_events,
    }
