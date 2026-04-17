"""Webhook handlers extracted from ``web.app``."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable, Optional

from models.models import CISnapshot, BuildRecord


def handle_build_complete(
    payload: dict[str, Any],
    *,
    load_snapshot: Callable[[], Optional[CISnapshot]],
    save_snapshot: Callable[[CISnapshot], None],
    is_collecting: Callable[[], bool],
    load_cfg: Callable[[], dict],
    trigger_collect: Callable[[dict], None],
) -> dict[str, Any]:
    snap = load_snapshot() or CISnapshot()
    record = BuildRecord(
        source=payload.get("source", "webhook"),
        source_instance=(payload.get("source_instance") or None),
        job_name=payload.get("job", "unknown"),
        build_number=payload.get("build_number"),
        status=payload.get("status", "unknown"),
        started_at=datetime.now(tz=timezone.utc),
        url=payload.get("url"),
        critical=payload.get("critical", False),
    )
    snap.builds.insert(0, record)
    save_snapshot(snap)

    if payload.get("trigger_collect", False) and not is_collecting():
        cfg = load_cfg()
        trigger_collect(cfg)
        return {"ok": True, "message": "Build record added. Full collect triggered."}

    return {"ok": True, "message": "Build record added."}
