"""Trends + uptime computations.

Extracted from ``web.app`` to reduce its size while preserving behavior.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from web.core import trends as trends_core


def trends_compute(days: int, *, history_path: Path | None = None) -> list:
    """Compute trend aggregates for the given lookback window."""
    return trends_core.compute_trends(days, history_path=history_path)


def uptime_compute(
    days: int,
    *,
    history_path: Path | None = None,
    sqlite_available: bool,
    db_svc_uptime: Callable[[int], dict] | None,
) -> dict:
    """Compute per-service uptime history (SQLite when available, else trends history)."""
    if sqlite_available and db_svc_uptime is not None:
        try:
            result = db_svc_uptime(days)
            if result:
                return result
        except Exception:
            pass
    history = trends_core.compute_trends(days, history_path=history_path)
    if not history:
        return {}
    cutoff = (datetime.now(tz=timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    recent = [e for e in history if e.get("date", "") >= cutoff]
    result: dict[str, list[dict]] = {}
    for entry in recent:
        sh = entry.get("service_health", {})
        for name, status in sh.items():
            result.setdefault(name, []).append({"date": entry["date"], "status": status})
    return result
