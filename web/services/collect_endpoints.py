"""API endpoints for manual/auto collection controls."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)


def collect_status(
    *,
    collect_status_payload: Callable[..., dict],
    collect_state: dict,
    auto_collect_enabled: bool,
    auto_collect_enabled_at_iso: str | None,
) -> dict:
    """Return current collection status payload for the UI."""
    return collect_status_payload(
        collect_state=collect_state,
        auto_collect_enabled=auto_collect_enabled,
        auto_collect_enabled_at_iso=auto_collect_enabled_at_iso,
    )


async def set_auto_collect(
    *,
    request_json: Callable[[], Awaitable[Any]],
    rid: str,
    load_cfg: Callable[[], dict],
    collect_state: dict,
    parse_enabled: Callable[[dict], bool],
    do_collect_task_factory: Callable[[dict], "asyncio.Task[None]"],
    auto_collect_enabled_ref: dict,
    auto_collect_enabled_at_iso_ref: dict,
) -> dict:
    """Enable/disable auto-collect and optionally trigger immediate collect."""
    try:
        body = await request_json()
    except Exception:
        body = {}
    enabled = parse_enabled(body)
    auto_collect_enabled_ref["value"] = enabled
    auto_collect_enabled_at_iso_ref["value"] = datetime.now(tz=timezone.utc).isoformat() if enabled else None
    logger.info("[%s] auto-collect set to %s", rid, "on" if enabled else "off")

    if enabled:
        try:
            cfg = load_cfg()
        except Exception:
            cfg = None
        if cfg and not collect_state.get("is_collecting"):
            do_collect_task_factory(cfg)
    return {"ok": True, "enabled": bool(auto_collect_enabled_ref.get("value"))}


async def trigger_collect(
    *,
    request_json: Callable[[], Awaitable[Any]],
    rid: str,
    collect_state: dict,
    load_cfg: Callable[[], dict],
    parse_force_full: Callable[[dict], bool],
    do_collect_task_factory: Callable[[dict, bool], "asyncio.Task[None]"],
    started_payload: Callable[[], dict],
) -> dict:
    """Trigger a one-off collection run (optionally force full refresh)."""
    if collect_state.get("is_collecting"):
        logger.info("[%s] collect rejected: already in progress", rid)
        return {"ok": False, "message": "Collection already in progress."}
    try:
        body = await request_json()
    except Exception:
        body = {}
    force_full = False
    try:
        force_full = parse_force_full(body)
    except Exception:
        force_full = False

    cfg = load_cfg()
    logger.info("[%s] manual collect started", rid)
    do_collect_task_factory(cfg, force_full)
    return started_payload()
