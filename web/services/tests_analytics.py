"""Helper functions for tests aggregation and filtering.

These functions were extracted from ``web.app`` to keep the main module smaller
and to allow routes/services to reuse them without importing the whole app.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any


def aggregate_top_failing_tests(
    tests: list[Any],
    *,
    top_n: int,
    suite_sub: str = "",
    name_sub: str = "",
    message_max: int = 300,
) -> list[dict[str, Any]]:
    """Group failed/error runs by test_name; pick error text from the latest run that has one.

    Key includes source_instance + parser source so "real" mode doesn't mix different parsers.
    """
    by_name: dict[str, list[Any]] = defaultdict(list)
    for t in tests:
        if t.status_normalized in ("failed", "error"):
            inst = getattr(t, "source_instance", None) or ""
            src = getattr(t, "source", None) or "unknown"
            key = f"{inst}::{src}::{t.test_name}"
            by_name[key].append(t)

    def _ts(rec: Any) -> datetime:
        ts = rec.timestamp
        if ts is None:
            return datetime.min.replace(tzinfo=timezone.utc)
        if ts.tzinfo is None:
            return ts.replace(tzinfo=timezone.utc)
        return ts.astimezone(timezone.utc)

    rows: list[dict[str, Any]] = []
    no_detail = "(no failure text in report)"
    for key, recs in by_name.items():
        recs_sorted = sorted(recs, key=_ts, reverse=True)
        latest = recs_sorted[0]
        inst = ""
        src = None
        tname = key
        if "::" in key:
            parts = key.split("::", 2)
            inst = parts[0] if len(parts) > 0 else ""
            src = parts[1] if len(parts) > 1 else None
            tname = parts[2] if len(parts) > 2 else key
        suite_val = latest.suite
        msg: str | None = None
        for r in recs_sorted:
            fm = r.failure_message
            if fm and str(fm).strip().lower() != "null":
                msg = str(fm).strip()
                break
        if not msg:
            msg = no_detail
        if message_max > 0 and len(msg) > message_max:
            msg = msg[:message_max]
        rows.append(
            {
                "source_instance": inst or None,
                "source": src or getattr(latest, "source", None) or None,
                "test_name": tname,
                "count": len(recs),
                "suite": suite_val,
                "message": msg,
            }
        )

    rows.sort(key=lambda x: (-x["count"], x["test_name"]))
    rows = rows[:top_n]

    if suite_sub:
        sl = suite_sub.lower()
        rows = [r for r in rows if sl in (r.get("suite") or "").lower()]
    if name_sub:
        nl = name_sub.lower()
        rows = [r for r in rows if nl in r["test_name"].lower()]
    return rows


def filter_tests_by_source(items: list[Any], source: str) -> list[Any]:
    """Filter tests by source selector (synthetic/real/specific)."""
    s = (source or "").strip().lower()
    if not s:
        return items
    if s == "synthetic":
        return [t for t in items if (t.source or "").strip().lower() == "jenkins_build"]
    if s == "real":
        return [t for t in items if (t.source or "").strip().lower() != "jenkins_build"]
    return [t for t in items if (t.source or "").strip().lower() == s]


def filter_tests_by_lookback_hours(
    tests: list[Any],
    *,
    hours: int = 0,
    days: int = 0,
) -> list[Any]:
    """Keep tests within the UTC lookback window.

    `days` overrides `hours` if both are set.
    """
    lookback_h = 0
    if days and int(days) > 0:
        lookback_h = int(days) * 24
    elif hours and int(hours) > 0:
        lookback_h = int(hours)
    if lookback_h <= 0:
        return list(tests)

    cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=lookback_h)

    def _ts(rec: Any) -> datetime:
        ts = getattr(rec, "timestamp", None)
        if ts is None:
            return datetime.min.replace(tzinfo=timezone.utc)
        if ts.tzinfo is None:
            return ts.replace(tzinfo=timezone.utc)
        return ts.astimezone(timezone.utc)

    return [t for t in tests if _ts(t) >= cutoff]


def tests_breakdown_real_vs_synth(items: list[Any]) -> dict[str, int]:
    """Count totals/failed for real vs synthetic tests."""
    real_total = 0
    real_failed = 0
    syn_total = 0
    syn_failed = 0
    for t in items:
        src = (t.source or "").strip().lower()
        is_syn = src == "jenkins_build"
        if is_syn:
            syn_total += 1
            if t.status_normalized in ("failed", "error"):
                syn_failed += 1
        else:
            real_total += 1
            if t.status_normalized in ("failed", "error"):
                real_failed += 1
    return {
        "real_total": real_total,
        "real_failed": real_failed,
        "synthetic_total": syn_total,
        "synthetic_failed": syn_failed,
    }
