"""Analytics endpoints helpers (sparklines, flaky)."""

from __future__ import annotations

from typing import Callable


def api_analytics_sparklines(
    *,
    sqlite_available: bool,
    db_build_duration: Callable[[str, int], list[dict]] | None,
    jobs: str,
    limit_per_job: int,
) -> dict[str, list[dict]]:
    """Return sparkline points per job (if SQLite history enabled)."""
    if (not sqlite_available) or db_build_duration is None:
        return {}
    n = max(3, min(limit_per_job, 30))
    names = [j.strip() for j in jobs.split(",") if j.strip()][:40]
    out: dict[str, list[dict]] = {}
    for name in names:
        pts = db_build_duration(name, n)
        if pts:
            out[name] = pts
    return out


def api_analytics_flaky(
    *,
    sqlite_available: bool,
    db_flaky_analysis: Callable[[float, int, int], list[dict]] | None,
    threshold: float,
    min_runs: int,
    days: int,
) -> dict:
    """Return flaky analysis items (if SQLite history enabled)."""
    if (not sqlite_available) or db_flaky_analysis is None:
        return {"items": [], "source": "none"}
    items = db_flaky_analysis(threshold, min_runs, days)
    return {"items": items, "source": "sqlite"}
