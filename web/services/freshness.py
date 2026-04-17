from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def snapshot_freshness(*, snap: Any, stale_threshold_seconds: int) -> dict[str, Any]:
    """Compute collected_at/age_seconds/stale fields for API payloads."""
    collected_at: str | None = None
    age_seconds: float | None = None
    stale = False
    if snap is not None:
        ca = getattr(snap, "collected_at", None)
        if ca is not None:
            if getattr(ca, "tzinfo", None) is None:
                ca = ca.replace(tzinfo=timezone.utc)
            else:
                ca = ca.astimezone(timezone.utc)
            collected_at = ca.isoformat()
            age_seconds = (datetime.now(tz=timezone.utc) - ca).total_seconds()
            stale = age_seconds > stale_threshold_seconds

    return {
        "collected_at": collected_at,
        "age_seconds": round(age_seconds, 1) if age_seconds is not None else None,
        "stale": stale,
        "stale_threshold_seconds": stale_threshold_seconds,
    }

