"""Start/stop helpers for background collect loop tasks."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import datetime, timezone


def prime_auto_collect_for_web_config(w_cfg: dict, *, logger) -> None:
    """
    When ``web.auto_collect`` is true, turn on the same server-side gate the
    dashboard LIVE toggle uses, so the collect loop runs without opening the UI.
    """
    if not w_cfg.get("auto_collect", True):
        return
    from web.core import runtime as rt

    rt.auto_collect_rt.enabled = True
    rt.auto_collect_rt.enabled_at_iso = datetime.now(tz=timezone.utc).isoformat()
    logger.info("web.auto_collect=true: server-side auto-collect enabled for this process.")


def clear_auto_collect_runtime(*, logger) -> None:
    """Disable server-side auto-collect (e.g. when web.auto_collect is turned off)."""
    from web.core import runtime as rt

    rt.auto_collect_rt.enabled = False
    rt.auto_collect_rt.enabled_at_iso = None
    logger.info("web.auto_collect=false: server-side auto-collect disabled.")


def start_collect_loop_task(
    *,
    cfg: dict,
    w_cfg: dict,
    collect_state: dict,
    collect_loop: Callable[[dict], "asyncio.Future[None]"],
    create_task: Callable[["asyncio.Future[None]"], asyncio.Task],
    logger,
) -> asyncio.Task | None:
    """Start background collect loop task if enabled in config."""
    interval = int(w_cfg.get("collect_interval_seconds", 300))
    collect_state["interval_seconds"] = interval
    if w_cfg.get("auto_collect", True):
        prime_auto_collect_for_web_config(w_cfg, logger=logger)
        logger.info("Collect loop task started (interval=%ds).", interval)
        return create_task(collect_loop(cfg))
    logger.info("Auto-collect disabled in config (web.auto_collect=false).")
    return None


async def cancel_task(task: asyncio.Task | None) -> None:
    """Cancel background task and await it."""
    if not task:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
