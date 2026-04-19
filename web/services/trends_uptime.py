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


def _job_name_from_event_title(title: str, *, prefix: str) -> str:
    t = str(title or "")
    if not t.startswith(prefix):
        return ""
    return t[len(prefix) :].strip()


def trends_history_summary(
    days: int,
    *,
    trends_compute: Callable[[int], list],
    event_feed_load: Callable[[int], list[dict]],
) -> dict:
    """Compute history KPIs for Trends dashboard cards."""
    data = trends_compute(days) or []
    days_count = max(1, len(data))
    failed_builds = sum(int(d.get("builds_failed", 0) or 0) for d in data)
    crash_freq = failed_builds / float(days_count)

    by_job: dict[str, dict[str, int]] = {}
    for d in data:
        jf = d.get("job_failures", {}) or {}
        jt = d.get("job_totals", {}) or {}
        for job, cnt in jf.items():
            rec = by_job.setdefault(str(job), {"failed": 0, "total": 0})
            rec["failed"] += int(cnt or 0)
        for job, cnt in jt.items():
            rec = by_job.setdefault(str(job), {"failed": 0, "total": 0})
            rec["total"] += int(cnt or 0)

    top_jobs = []
    for job, rec in by_job.items():
        total = max(0, int(rec.get("total", 0)))
        failed = max(0, int(rec.get("failed", 0)))
        rate = (100.0 * failed / float(total)) if total > 0 else 0.0
        top_jobs.append({"job_name": job, "failed": failed, "total": total, "fail_rate_pct": round(rate, 1)})
    top_jobs.sort(key=lambda x: (x["failed"], x["fail_rate_pct"]), reverse=True)
    top_jobs = top_jobs[:8]

    events = event_feed_load(2000) or []
    # Parse and sort to ensure deterministic pairing.
    parsed_events = []
    for e in events:
        ts = str(e.get("ts") or "").strip()
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            else:
                dt = dt.astimezone(timezone.utc)
        except Exception:
            continue
        parsed_events.append((dt, e))
    parsed_events.sort(key=lambda x: x[0])

    opened_fail_ts: dict[str, datetime] = {}
    rec_minutes: list[float] = []
    for dt, e in parsed_events:
        kind = str(e.get("kind") or "")
        title = str(e.get("title") or "")
        if kind == "build_fail":
            job = _job_name_from_event_title(title, prefix="Job FAILED:")
            if job and job not in opened_fail_ts:
                opened_fail_ts[job] = dt
        elif kind == "build_recovered":
            job = _job_name_from_event_title(title, prefix="Job RECOVERED:")
            if job and job in opened_fail_ts:
                delta = (dt - opened_fail_ts[job]).total_seconds() / 60.0
                if delta >= 0:
                    rec_minutes.append(delta)
                del opened_fail_ts[job]

    avg_recovery = (sum(rec_minutes) / len(rec_minutes)) if rec_minutes else None
    return {
        "days": int(days),
        "days_with_data": int(days_count),
        "crash_frequency_per_day": round(crash_freq, 2),
        "most_problematic_jobs": top_jobs,
        "avg_recovery_minutes": round(avg_recovery, 1) if avg_recovery is not None else None,
        "recovery_samples": len(rec_minutes),
    }
