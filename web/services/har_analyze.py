"""Blocking HAR analysis (run in a thread pool from async routes)."""

from __future__ import annotations

from collections import Counter
from typing import Any
from urllib.parse import urlparse


def analyze_har_payload(payload: dict[str, Any], *, file_name: str | None = None) -> dict[str, Any]:
    """Parse HAR JSON and return lightweight diagnostics."""

    def _safe_int(value: object, *, default: int = 0) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def _safe_float(value: object, *, default: float = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    log = payload.get("log") if isinstance(payload, dict) else None
    entries = log.get("entries") if isinstance(log, dict) else None
    if not isinstance(entries, list):
        raise ValueError("Invalid HAR: missing log.entries list")

    total = len(entries)
    failed = []
    slow = []
    status_counter = Counter()
    host_counter = Counter()
    total_time = 0.0
    timed_count = 0
    warnings: list[str] = []
    skipped_entries = 0
    for idx, item in enumerate(entries):
        if not isinstance(item, dict):
            skipped_entries += 1
            warnings.append(f"entry[{idx}] skipped: expected object")
            continue
        request = item.get("request") if isinstance(item.get("request"), dict) else {}
        response = item.get("response") if isinstance(item.get("response"), dict) else {}
        timings = item.get("timings") if isinstance(item.get("timings"), dict) else {}
        url = str(request.get("url") or "")
        method = str(request.get("method") or "GET")
        raw_status = response.get("status")
        status = _safe_int(raw_status, default=0)
        if raw_status not in (None, "") and status == 0:
            warnings.append(f"entry[{idx}] invalid response.status={raw_status!r}; using 0")
        raw_time = item.get("time")
        time_ms = _safe_float(raw_time, default=0.0)
        if raw_time not in (None, "") and time_ms == 0.0:
            warnings.append(f"entry[{idx}] invalid time={raw_time!r}; using 0")
        if time_ms > 0:
            total_time += time_ms
            timed_count += 1
        host = urlparse(url).netloc
        if host:
            host_counter[host] += 1
        if status > 0:
            status_counter[str(status)] += 1

        net_error = str(item.get("_error") or item.get("_errorText") or "").strip()
        if status >= 400 or net_error:
            failed.append(
                {
                    "method": method,
                    "url": url,
                    "status": status or None,
                    "time_ms": round(time_ms, 2) if time_ms else None,
                    "error": net_error or None,
                }
            )
        if time_ms >= 2000:
            raw_wait = timings.get("wait")
            wait_ms = _safe_float(raw_wait, default=0.0)
            if raw_wait not in (None, "") and wait_ms == 0.0:
                warnings.append(f"entry[{idx}] invalid timings.wait={raw_wait!r}; using 0")
            slow.append(
                {
                    "method": method,
                    "url": url,
                    "status": status or None,
                    "time_ms": round(time_ms, 2),
                    "wait_ms": round(wait_ms, 2) if wait_ms else None,
                }
            )

    failed.sort(key=lambda x: (x.get("status") is None, -(x.get("status") or 0)))
    slow.sort(key=lambda x: x.get("time_ms") or 0, reverse=True)
    top_statuses = [{"status": k, "count": v} for k, v in status_counter.most_common(10)]
    top_hosts = [{"host": k, "count": v} for k, v in host_counter.most_common(10)]

    return {
        "file_name": file_name,
        "summary": {
            "total_requests": total,
            "failed_requests": len(failed),
            "slow_requests": len(slow),
            "avg_time_ms": round((total_time / timed_count), 2) if timed_count else 0,
        },
        "top_statuses": top_statuses,
        "top_hosts": top_hosts,
        "failed_requests": failed[:200],
        "slow_requests": slow[:200],
        "warnings": warnings[:200],
        "skipped_entries": skipped_entries,
    }
