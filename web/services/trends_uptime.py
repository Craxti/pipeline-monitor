"""Trends + uptime computations.

Extracted from ``web.app`` to reduce its size while preserving behavior.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from web.core import trends as trends_core


def trends_compute(days: int, *, history_path: Path) -> list:
    return trends_core.compute_trends(days, history_path=history_path)


def uptime_compute(
    days: int,
    *,
    history_path: Path,
    sqlite_available: bool,
    db_svc_uptime: Callable[[int], dict] | None,
) -> dict:
    if sqlite_available and db_svc_uptime is not None:
        try:
            result = db_svc_uptime(days)
            if result:
                return result
        except Exception:
            pass
    if not history_path.exists():
        return {}
    try:
        history = json.loads(history_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    cutoff = (datetime.now(tz=timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    recent = [e for e in history if e.get("date", "") >= cutoff]
    result: dict[str, list[dict]] = {}
    for entry in recent:
        sh = entry.get("service_health", {})
        for name, status in sh.items():
            result.setdefault(name, []).append({"date": entry["date"], "status": status})
    return result
