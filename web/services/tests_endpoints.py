"""API endpoints for test records (filtered, paginated, analytics)."""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from fastapi import HTTPException


async def api_tests(
    *,
    load_snapshot_async: Callable[[], Awaitable[Any]],
    normalize_test_status: Callable[[str], str],
    tests_breakdown_real_vs_synth: Callable[[list[Any]], dict[str, int]],
    filter_tests_by_source: Callable[[list[Any], str], list[Any]],
    page: int,
    per_page: int,
    status: str,
    suite: str,
    name: str,
    hours: int,
    source: str,
) -> dict:
    """Return paginated tests list with breakdown and top failures."""
    snap = await load_snapshot_async()
    if snap is None:
        raise HTTPException(404, "No snapshot data found.")

    items = snap.tests
    if status:
        want = normalize_test_status(status)
        items = [t for t in items if t.status_normalized == want]
    if suite:
        items = [t for t in items if suite.lower() in (t.suite or "").lower()]
    if name:
        items = [t for t in items if name.lower() in t.test_name.lower()]
    if hours > 0:
        cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=hours)
        items = [
            t
            for t in items
            if t.timestamp
            and t.timestamp.replace(
                tzinfo=timezone.utc if t.timestamp.tzinfo is None else t.timestamp.tzinfo
            )
            >= cutoff
        ]

    breakdown_base = snap.tests
    if suite:
        breakdown_base = [t for t in breakdown_base if suite.lower() in (t.suite or "").lower()]
    if name:
        breakdown_base = [t for t in breakdown_base if name.lower() in t.test_name.lower()]
    if hours > 0:
        cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=hours)
        breakdown_base = [
            t
            for t in breakdown_base
            if t.timestamp
            and t.timestamp.replace(
                tzinfo=timezone.utc if t.timestamp.tzinfo is None else t.timestamp.tzinfo
            )
            >= cutoff
        ]
    breakdown = tests_breakdown_real_vs_synth(breakdown_base)

    items = filter_tests_by_source(items, source)

    total = len(items)
    start = (page - 1) * per_page
    end = start + per_page
    page_items = items[start:end]

    return {
        "items": [json.loads(t.model_dump_json()) for t in page_items],
        "page": page,
        "per_page": per_page,
        "total": total,
        "has_more": end < total,
        "breakdown": breakdown,
    }


async def api_top_failures(
    *,
    load_snapshot: Callable[[], Any],
    filter_tests_by_lookback_hours: Callable[..., list[Any]],
    filter_tests_by_source: Callable[[list[Any], str], list[Any]],
    aggregate_top_failing_tests: Callable[..., list[dict[str, Any]]],
    n: int,
    page: int,
    per_page: int,
    suite: str,
    name: str,
    source: str,
    hours: int,
    days: int,
) -> dict:
    """Return aggregated top failing tests (paged)."""
    snap = load_snapshot()
    if snap is None:
        raise HTTPException(404, "No snapshot data found.")

    tests_items = filter_tests_by_lookback_hours(
        snap.tests, hours=int(hours or 0), days=int(days or 0)
    )

    src = (source or "").strip().lower()
    if not src:
        counter: Counter = Counter()
        messages: dict[str, str] = {}
        msg_ts: dict[str, datetime] = {}
        suites: dict[str, str] = {}
        suite_ts: dict[str, datetime] = {}
        sources: dict[str, str] = {}

        def _rec_ts(rec: Any) -> datetime:
            ts = getattr(rec, "timestamp", None)
            if ts is None:
                return datetime.min.replace(tzinfo=timezone.utc)
            if ts.tzinfo is None:
                return ts.replace(tzinfo=timezone.utc)
            return ts.astimezone(timezone.utc)

        def _candidate_message(rec: Any) -> str | None:
            src_l = (rec.source or "").strip().lower()
            fm = rec.failure_message or ""
            if fm and str(fm).strip().lower() != "null":
                return str(fm).strip()
            if src_l == "jenkins_build":
                st = (rec.status or "").strip().lower()
                return "Job failed/unstable" if st in ("failed", "error") else "Job failed"
            return None

        for t in tests_items:
            if t.status_normalized in ("failed", "error"):
                inst = getattr(t, "source_instance", None) or ""
                key = f"{inst}::{(t.source or 'unknown')}::{t.test_name}"
                counter[key] += 1
                sources[key] = (t.source or "unknown")
                ts = _rec_ts(t)
                if t.suite and str(t.suite).strip():
                    prev = suite_ts.get(key)
                    if prev is None or ts >= prev:
                        suite_ts[key] = ts
                        suites[key] = str(t.suite).strip()

                cand = _candidate_message(t)
                if not cand:
                    continue
                prev_m_ts = msg_ts.get(key)
                if prev_m_ts is None or ts >= prev_m_ts:
                    msg_ts[key] = ts
                    messages[key] = cand[:300]

        no_detail = "(no failure text in report)"
        all_items = [
            {
                "source": sources.get(k),
                "source_instance": (k.split("::", 2)[0] or None),
                "test_name": k.split("::", 2)[2],
                "count": c,
                "suite": suites.get(k),
                "message": (messages.get(k) or no_detail),
            }
            for k, c in counter.most_common(n)
        ]
        if suite:
            all_items = [i for i in all_items if suite.lower() in (i["suite"] or "").lower()]
        if name:
            all_items = [i for i in all_items if name.lower() in (i["test_name"] or "").lower()]
    else:
        tests = filter_tests_by_source(tests_items, source)
        all_items = aggregate_top_failing_tests(
            tests,
            top_n=n,
            suite_sub=suite,
            name_sub=name,
            message_max=300,
        )
        for it in all_items:
            it.setdefault("source", src if src not in ("real", "synthetic") else None)

    total = len(all_items)
    start = (page - 1) * per_page
    end = start + per_page
    return {
        "items": all_items[start:end],
        "page": page,
        "per_page": per_page,
        "total": total,
        "has_more": end < total,
    }
