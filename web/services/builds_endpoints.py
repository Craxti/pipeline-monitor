"""API endpoints for build records (filtered, paginated)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from fastapi import HTTPException


def _history_sqlite_available() -> bool:
    try:
        from web.services import sqlite_imports as sq

        return bool(sq.SQLITE_AVAILABLE)
    except Exception:
        return False


def _history_builds_days(hours: int) -> int:
    if hours and int(hours) > 0:
        return max(1, int((int(hours) + 23) / 24))
    try:
        from web.db import _get_history_retention_days

        retention = int(_get_history_retention_days() or 0)
        return retention if retention > 0 else 90
    except Exception:
        return 90


def _api_builds_from_history(
    snap: Any,
    cfg: dict,
    *,
    inst_label_for_build_with_cfg: Callable[[Any, dict], str],
    normalize_build_status: Callable[[str], str],
    job_build_analytics: Callable[[Any], dict[str, dict]],
    page: int,
    per_page: int,
    source: str,
    status: str,
    job: str,
    hours: int,
) -> dict | None:
    if not _history_sqlite_available():
        return None
    try:
        from web.db import ensure_database_initialized, query_builds_history
        from models.models import BuildRecord, normalize_build_status as norm_build_st
    except ImportError:
        return None
    if not ensure_database_initialized():
        return None

    days = _history_builds_days(hours)
    data = query_builds_history(
        job=job,
        source=source,
        status=status,
        page=page,
        per_page=per_page,
        days=days,
    )
    if int(data.get("total") or 0) <= 0 and not data.get("items"):
        return None

    job_ctx = job_build_analytics(snap)
    out_items: list[dict] = []
    for row in data.get("items") or []:
        try:
            st_raw = norm_build_st(row.get("status") or "unknown")
            started = row.get("started_at")
            if isinstance(started, str) and started:
                try:
                    started = datetime.fromisoformat(started.replace("Z", "+00:00"))
                except Exception:
                    started = None
            b = BuildRecord(
                source=row.get("source") or "unknown",
                job_name=row.get("job_name") or "",
                build_number=row.get("build_number"),
                status=st_raw,
                started_at=started,
                duration_seconds=row.get("duration_seconds"),
                branch=row.get("branch"),
                commit_sha=row.get("commit_sha"),
                url=row.get("url"),
                critical=bool(row.get("critical")),
            )
        except Exception:
            continue
        inst = inst_label_for_build_with_cfg(b, cfg) or ""
        payload = json.loads(b.model_dump_json())
        payload["analytics"] = job_ctx.get(b.job_name, {})
        payload["instance"] = inst
        out_items.append(payload)

    return {
        "items": out_items,
        "page": page,
        "per_page": per_page,
        "total": int(data.get("total") or 0),
        "has_more": bool(data.get("has_more")),
        "group_counts": {},
    }


def _api_builds_sync(
    snap: Any,
    cfg: dict,
    *,
    is_snapshot_build_enabled: Callable[[Any, dict], bool],
    inst_label_for_build_with_cfg: Callable[[Any, dict], str],
    normalize_build_status: Callable[[str], str],
    job_build_analytics: Callable[[Any], dict[str, dict]],
    page: int,
    per_page: int,
    source: str,
    instance: str,
    status: str,
    job: str,
    hours: int,
) -> dict:
    if not (instance or "").strip():
        hist = _api_builds_from_history(
            snap,
            cfg,
            inst_label_for_build_with_cfg=inst_label_for_build_with_cfg,
            normalize_build_status=normalize_build_status,
            job_build_analytics=job_build_analytics,
            page=page,
            per_page=per_page,
            source=source,
            status=status,
            job=job,
            hours=hours,
        )
        if hist is not None:
            return hist

    items = [b for b in (snap.builds or []) if is_snapshot_build_enabled(b, cfg)]
    if source:
        items = [b for b in items if (b.source or "").lower() == source.lower()]
    if instance:
        want_inst = instance.strip().lower()
        if want_inst:
            items = [b for b in items if (inst_label_for_build_with_cfg(b, cfg) or "").strip().lower() == want_inst]
    if status:
        want = normalize_build_status(status)
        items = [b for b in items if b.status_normalized == want]
    if job:
        items = [b for b in items if job.lower() in (b.job_name or "").lower()]
    if hours > 0:
        cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=hours)
        items = [
            b
            for b in items
            if b.started_at
            and b.started_at.replace(tzinfo=timezone.utc if b.started_at.tzinfo is None else b.started_at.tzinfo)
            >= cutoff
        ]

    group_counts: dict[str, dict[str, int]] = {}
    for b in items:
        gk = f"{(b.source or '').strip().lower()}||" f"{(inst_label_for_build_with_cfg(b, cfg) or '').strip().lower()}"
        if gk not in group_counts:
            group_counts[gk] = {"fail": 0, "warn": 0, "ok": 0, "total": 0}
        rec = group_counts[gk]
        rec["total"] += 1
        sn = b.status_normalized
        if sn == "failure":
            rec["fail"] += 1
        elif sn == "unstable":
            rec["warn"] += 1
        elif sn == "success":
            rec["ok"] += 1

    total = len(items)
    start = (page - 1) * per_page
    end = start + per_page
    page_items = items[start:end]

    job_ctx = job_build_analytics(snap)
    out_items: list[dict] = []
    for b in page_items:
        row = json.loads(b.model_dump_json())
        row["analytics"] = job_ctx.get(b.job_name, {})
        row["instance"] = inst_label_for_build_with_cfg(b, cfg)
        out_items.append(row)

    return {
        "items": out_items,
        "page": page,
        "per_page": per_page,
        "total": total,
        "has_more": end < total,
        "group_counts": group_counts,
    }


async def api_builds(
    *,
    load_snapshot_async: Callable[[], Awaitable[Any]],
    load_yaml_config: Callable[[], dict],
    is_snapshot_build_enabled: Callable[[Any, dict], bool],
    inst_label_for_build_with_cfg: Callable[[Any, dict], str],
    normalize_build_status: Callable[[str], str],
    job_build_analytics: Callable[[Any], dict[str, dict]],
    page: int,
    per_page: int,
    source: str,
    instance: str,
    status: str,
    job: str,
    hours: int,
) -> dict:
    """Return paginated build list plus analytics and group counters."""
    page = max(1, int(page or 1))
    per_page = min(max(1, int(per_page or 20)), 200)
    snap = await load_snapshot_async()
    if snap is None:
        raise HTTPException(404, "No snapshot data found.")
    from web.core.api_executor import run_api_thread

    cfg = await run_api_thread(load_yaml_config)

    return await run_api_thread(
        lambda: _api_builds_sync(
            snap,
            cfg,
            is_snapshot_build_enabled=is_snapshot_build_enabled,
            inst_label_for_build_with_cfg=inst_label_for_build_with_cfg,
            normalize_build_status=normalize_build_status,
            job_build_analytics=job_build_analytics,
            page=page,
            per_page=per_page,
            source=source,
            instance=instance,
            status=status,
            job=job,
            hours=hours,
        )
    )
