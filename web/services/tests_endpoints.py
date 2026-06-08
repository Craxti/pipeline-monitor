"""API endpoints for test records (filtered, paginated, analytics)."""

from __future__ import annotations

import asyncio
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from fastapi import HTTPException


def _history_sqlite_available() -> bool:
    try:
        from web.services import sqlite_imports as sq

        return bool(sq.SQLITE_AVAILABLE)
    except Exception:
        return False


def _history_test_records(rows: list[dict[str, Any]]) -> list[Any]:
    from models.models import TestRecord

    out: list[Any] = []
    for row in rows:
        ts = row.get("timestamp")
        if isinstance(ts, str) and ts:
            try:
                ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            except Exception:
                ts = None
        try:
            out.append(
                TestRecord(
                    source=row.get("source") or "unknown",
                    source_instance=row.get("source_instance"),
                    suite=row.get("suite"),
                    test_name=row.get("test_name") or "",
                    status=row.get("status") or "unknown",
                    duration_seconds=row.get("duration_seconds"),
                    failure_message=row.get("failure_message"),
                    timestamp=ts,
                    file_path=row.get("file_path"),
                    build_number=row.get("build_number"),
                    allure_uid=row.get("allure_uid"),
                    allure_description=row.get("allure_description"),
                    allure_attachments=row.get("allure_attachments"),
                )
            )
        except Exception:
            continue
    return out


def _snapshot_test_meta_lookup(tests: list[Any]) -> dict[tuple[str, str, str], Any]:
    out: dict[tuple[str, str, str], Any] = {}
    for t in tests:
        key = (
            (getattr(t, "test_name", None) or "").strip().lower(),
            (getattr(t, "suite", None) or "").strip().lower(),
            (getattr(t, "source", None) or "").strip().lower(),
        )
        prev = out.get(key)
        if prev is None:
            out[key] = t
            continue
        pts = getattr(prev, "timestamp", None)
        tts = getattr(t, "timestamp", None)
        if tts and (not pts or tts > pts):
            out[key] = t
    return out


def _allure_meta_score(rec: Any) -> int:
    score = 0
    uid = getattr(rec, "allure_uid", None)
    if uid is not None and str(uid).strip():
        score += 4
    desc = getattr(rec, "allure_description", None)
    if desc is not None and str(desc).strip():
        score += 2
    att = getattr(rec, "allure_attachments", None)
    if att:
        score += 2
    if getattr(rec, "build_number", None) is not None:
        score += 1
    return score


def _snapshot_allure_by_name_suite(tests: list[Any]) -> dict[tuple[str, str], Any]:
    """Best snapshot row per (test_name, suite) for Allure meta (jenkins source variants)."""
    out: dict[tuple[str, str], Any] = {}
    for t in tests:
        key = (
            (getattr(t, "test_name", None) or "").strip().lower(),
            (getattr(t, "suite", None) or "").strip().lower(),
        )
        if not key[0]:
            continue
        prev = out.get(key)
        if prev is None:
            out[key] = t
            continue
        ts = _allure_meta_score(t)
        ps = _allure_meta_score(prev)
        if ts > ps:
            out[key] = t
            continue
        if ts == ps:
            pts = getattr(prev, "timestamp", None)
            tts = getattr(t, "timestamp", None)
            if tts and (not pts or tts > pts):
                out[key] = t
    return out


def _is_jenkins_test_source(source: str) -> bool:
    s = (source or "").strip().lower()
    return s.startswith("jenkins_") and s != "jenkins_build"


def _pick_snapshot_allure_meta(
    rec: Any,
    lookup: dict[tuple[str, str, str], Any],
    by_name_suite: dict[tuple[str, str], Any],
) -> Any | None:
    name = (rec.test_name or "").strip().lower()
    suite = (rec.suite or "").strip().lower()
    src = (rec.source or "").strip().lower()
    hit = lookup.get((name, suite, src))
    if hit is not None and _allure_meta_score(hit) > 0:
        return hit
    if _is_jenkins_test_source(src):
        alt = by_name_suite.get((name, suite))
        if alt is not None and _allure_meta_score(alt) > 0:
            return alt
    return None


def _allure_patch_from_snapshot(rec: Any, snap: Any) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    if rec.build_number is None and getattr(snap, "build_number", None) is not None:
        patch["build_number"] = snap.build_number
    if not rec.source_instance and getattr(snap, "source_instance", None):
        patch["source_instance"] = snap.source_instance
    if not rec.allure_uid and getattr(snap, "allure_uid", None):
        patch["allure_uid"] = snap.allure_uid
    if not rec.allure_description and getattr(snap, "allure_description", None):
        patch["allure_description"] = snap.allure_description
    if not rec.allure_attachments and getattr(snap, "allure_attachments", None):
        patch["allure_attachments"] = snap.allure_attachments
    return patch


def _enrich_test_records_from_snapshot(records: list[Any], snap_tests: list[Any]) -> list[Any]:
    """Fill missing Jenkins/Allure fields from the latest snapshot (older SQLite rows)."""
    if not snap_tests or not records:
        return records
    lookup = _snapshot_test_meta_lookup(snap_tests)
    by_name_suite = _snapshot_allure_by_name_suite(snap_tests)
    enriched: list[Any] = []
    for rec in records:
        snap = _pick_snapshot_allure_meta(rec, lookup, by_name_suite)
        if not snap:
            enriched.append(rec)
            continue
        patch = _allure_patch_from_snapshot(rec, snap)
        enriched.append(rec.model_copy(update=patch) if patch else rec)
    return enriched


def _api_tests_from_history(
    *,
    normalize_test_status: Callable[[str], str],
    tests_breakdown_real_vs_synth: Callable[[list[Any]], dict[str, int]],
    page: int,
    per_page: int,
    status: str,
    suite: str,
    name: str,
    hours: int,
    source: str,
    snap: Any = None,
) -> dict | None:
    if not _history_sqlite_available():
        return None
    try:
        from web.db import ensure_database_initialized, query_tests_history, query_tests_history_for_aggregate
    except ImportError:
        return None
    if not ensure_database_initialized():
        return None

    data = query_tests_history(
        status=status,
        suite=suite,
        name=name,
        source=source,
        hours=hours,
        days=0,
        page=page,
        per_page=per_page,
    )
    if data.get("total", 0) <= 0 and not data.get("items"):
        return None

    agg_rows = query_tests_history_for_aggregate(
        status_failed_only=False,
        suite=suite,
        name=name,
        source=source,
        hours=hours,
        days=0,
        limit=50000,
    )
    snap_tests = list(getattr(snap, "tests", None) or [])
    agg_records = _history_test_records(agg_rows)
    agg_records = _enrich_test_records_from_snapshot(agg_records, snap_tests)
    breakdown = tests_breakdown_real_vs_synth(agg_records)
    page_items = _history_test_records(data.get("items") or [])
    page_items = _enrich_test_records_from_snapshot(page_items, snap_tests)
    return {
        "items": [t.model_dump(mode="json") for t in page_items],
        "page": page,
        "per_page": per_page,
        "total": int(data.get("total") or 0),
        "has_more": bool(data.get("has_more")),
        "breakdown": breakdown,
    }


def _api_top_failures_from_history(
    *,
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
    snap: Any = None,
) -> dict | None:
    if not _history_sqlite_available():
        return None
    try:
        from web.db import ensure_database_initialized, query_tests_history_for_aggregate
    except ImportError:
        return None
    if not ensure_database_initialized():
        return None

    rows = query_tests_history_for_aggregate(
        status_failed_only=True,
        suite=suite,
        name=name,
        source=source,
        hours=hours,
        days=days,
        limit=50000,
    )
    if not rows:
        return None

    tests = _history_test_records(rows)
    tests = _enrich_test_records_from_snapshot(tests, list(getattr(snap, "tests", None) or []))
    all_items = aggregate_top_failing_tests(
        tests,
        top_n=n,
        suite_sub=suite,
        name_sub=name,
        message_max=300,
    )
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


def _api_tests_sync(
    snap: Any,
    *,
    normalize_test_status: Callable[[str], str],
    tests_breakdown_real_vs_synth: Callable[[list[Any]], dict[str, int]],
    filter_tests_by_source: Callable[[list[Any], str], list[Any]],
    filter_tests_by_instance: Callable[[list[Any], str], list[Any]],
    page: int,
    per_page: int,
    status: str,
    suite: str,
    name: str,
    hours: int,
    source: str,
    instance: str,
) -> dict:
    if not (instance or "").strip():
        hist = _api_tests_from_history(
            normalize_test_status=normalize_test_status,
            tests_breakdown_real_vs_synth=tests_breakdown_real_vs_synth,
            page=page,
            per_page=per_page,
            status=status,
            suite=suite,
            name=name,
            hours=hours,
            source=source,
            snap=snap,
        )
        if hist is not None:
            return hist

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
            and t.timestamp.replace(tzinfo=timezone.utc if t.timestamp.tzinfo is None else t.timestamp.tzinfo) >= cutoff
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
            and t.timestamp.replace(tzinfo=timezone.utc if t.timestamp.tzinfo is None else t.timestamp.tzinfo) >= cutoff
        ]
    breakdown = tests_breakdown_real_vs_synth(breakdown_base)

    items = filter_tests_by_source(items, source)
    items = filter_tests_by_instance(items, instance)

    total = len(items)
    start = (page - 1) * per_page
    end = start + per_page
    page_items = items[start:end]

    return {
        "items": [t.model_dump(mode="json") for t in page_items],
        "page": page,
        "per_page": per_page,
        "total": total,
        "has_more": end < total,
        "breakdown": breakdown,
    }


def _api_top_failures_sync(
    snap: Any,
    *,
    filter_tests_by_lookback_hours: Callable[..., list[Any]],
    filter_tests_by_source: Callable[[list[Any], str], list[Any]],
    filter_tests_by_instance: Callable[[list[Any], str], list[Any]],
    aggregate_top_failing_tests: Callable[..., list[dict[str, Any]]],
    n: int,
    page: int,
    per_page: int,
    suite: str,
    name: str,
    source: str,
    instance: str,
    hours: int,
    days: int,
) -> dict:
    if not (instance or "").strip():
        hist = _api_top_failures_from_history(
            filter_tests_by_lookback_hours=filter_tests_by_lookback_hours,
            filter_tests_by_source=filter_tests_by_source,
            aggregate_top_failing_tests=aggregate_top_failing_tests,
            n=n,
            page=page,
            per_page=per_page,
            suite=suite,
            name=name,
            source=source,
            hours=hours,
            days=days,
            snap=snap,
        )
        if hist is not None:
            return hist

    tests_items = filter_tests_by_lookback_hours(snap.tests, hours=int(hours or 0), days=int(days or 0))
    tests_items = filter_tests_by_instance(tests_items, instance)

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
            if src_l == "jenkins_unified":
                fm = rec.failure_message or ""
                if fm and str(fm).strip().lower() != "null":
                    return str(fm).strip()
            return None

        for t in tests_items:
            if t.status_normalized in ("failed", "error"):
                inst = getattr(t, "source_instance", None) or ""
                key = f"{inst}::{(t.source or 'unknown')}::{t.test_name}"
                counter[key] += 1
                sources[key] = t.source or "unknown"
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
            it.setdefault(
                "source",
                src if src not in ("real", "synthetic", "jenkins", "jenkins_merged", "gitlab", "github") else None,
            )

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


async def api_tests(
    *,
    load_snapshot_async: Callable[[], Awaitable[Any]],
    normalize_test_status: Callable[[str], str],
    tests_breakdown_real_vs_synth: Callable[[list[Any]], dict[str, int]],
    filter_tests_by_source: Callable[[list[Any], str], list[Any]],
    filter_tests_by_instance: Callable[[list[Any], str], list[Any]],
    page: int,
    per_page: int,
    status: str,
    suite: str,
    name: str,
    hours: int,
    source: str,
    instance: str,
) -> dict:
    """Return paginated tests list with breakdown and top failures."""
    snap = await load_snapshot_async()
    if snap is None:
        raise HTTPException(404, "No snapshot data found.")

    from web.core.api_executor import run_api_thread

    return await run_api_thread(
        lambda: _api_tests_sync(
            snap,
            normalize_test_status=normalize_test_status,
            tests_breakdown_real_vs_synth=tests_breakdown_real_vs_synth,
            filter_tests_by_source=filter_tests_by_source,
            filter_tests_by_instance=filter_tests_by_instance,
            page=page,
            per_page=per_page,
            status=status,
            suite=suite,
            name=name,
            hours=hours,
            source=source,
            instance=instance,
        )
    )


async def api_top_failures(
    *,
    load_snapshot_async: Callable[[], Awaitable[Any]],
    filter_tests_by_lookback_hours: Callable[..., list[Any]],
    filter_tests_by_source: Callable[[list[Any], str], list[Any]],
    filter_tests_by_instance: Callable[[list[Any], str], list[Any]],
    aggregate_top_failing_tests: Callable[..., list[dict[str, Any]]],
    n: int,
    page: int,
    per_page: int,
    suite: str,
    name: str,
    source: str,
    instance: str,
    hours: int,
    days: int,
) -> dict:
    """Return aggregated top failing tests (paged)."""
    snap = await load_snapshot_async()
    if snap is None:
        raise HTTPException(404, "No snapshot data found.")

    from web.core.api_executor import run_api_thread

    return await run_api_thread(
        lambda: _api_top_failures_sync(
            snap,
            filter_tests_by_lookback_hours=filter_tests_by_lookback_hours,
            filter_tests_by_source=filter_tests_by_source,
            filter_tests_by_instance=filter_tests_by_instance,
            aggregate_top_failing_tests=aggregate_top_failing_tests,
            n=n,
            page=page,
            per_page=per_page,
            suite=suite,
            name=name,
            source=source,
            instance=instance,
            hours=hours,
            days=days,
        )
    )
