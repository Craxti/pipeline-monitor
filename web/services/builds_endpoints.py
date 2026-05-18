"""API endpoints for build records (filtered, paginated)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from fastapi import HTTPException


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
    cfg = load_yaml_config()

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
