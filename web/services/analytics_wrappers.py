"""Wrappers around analytics computations for wiring/DI."""

from __future__ import annotations

from typing import Any


def status_str(build_analytics_mod, b: object) -> str:
    """Convert build status to normalized string."""
    return build_analytics_mod.status_str(b)


def job_build_analytics(build_analytics_mod, snapshot) -> dict[str, dict]:
    """Compute per-job build analytics."""
    return build_analytics_mod.job_build_analytics(snapshot)


def correlation_last_hour(
    correlation_mod,
    *,
    load_snapshot,
    load_events,
    events_limit: int = 500,
) -> dict:
    """Return correlation payload for the last hour."""
    return correlation_mod.correlation_last_hour(
        load_snapshot=load_snapshot,
        load_events=load_events,
        events_limit=events_limit,
    )


def trends_compute(trends_uptime_mod, days: int, *, history_path) -> list:
    """Compute trends series for the given lookback."""
    return trends_uptime_mod.trends_compute(days, history_path=history_path)


def uptime_compute(
    trends_uptime_mod,
    days: int,
    *,
    history_path,
    sqlite_available: bool,
    db_svc_uptime,
) -> dict[str, Any]:
    """Compute uptime series for the given lookback."""
    return trends_uptime_mod.uptime_compute(
        days,
        history_path=history_path,
        sqlite_available=sqlite_available,
        db_svc_uptime=db_svc_uptime,
    )
