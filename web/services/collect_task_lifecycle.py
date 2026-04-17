"""Start/stop helpers for background collect loop tasks."""

from __future__ import annotations

import asyncio
from collections.abc import Callable


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
        logger.info(
            "Auto-collect is configured (interval=%ds) but starts only when LIVE is enabled.",
            interval,
        )
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
