"""Auto-collect background loop implementation."""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from collections.abc import Awaitable, Callable

from web.services.collect_sync.exceptions import CollectCancelled

logger = logging.getLogger(__name__)


async def do_collect(
    cfg: dict,
    *,
    force_full: bool,
    collect_state: dict,
    collect_logs,
    collect_slow,
    push_collect_log: Callable[[str, str, str | None, str], None],
    run_collect_sync: Callable[..., None],
    sse_broadcast_async: Callable[[dict], Awaitable[None]],
    data_revision: int,
) -> None:
    """Async wrapper: run collection in thread pool, update shared state."""
    if collect_state.get("is_collecting"):
        logger.info("Collection already in progress, skipping.")
        return
    collect_state["is_collecting"] = True
    collect_state["cancel_requested"] = False
    collect_state["started_at"] = datetime.now(tz=timezone.utc).isoformat()
    collect_state["phase"] = "starting"
    collect_state["progress_main"] = "Starting collect…"
    collect_state["progress_sub"] = None
    collect_state["progress_counts"] = {"builds": 0, "tests": 0, "services": 0}
    collect_state["last_error"] = None
    collect_state["stop_reason"] = None
    collect_state["phase_timings_ms"] = {}
    collect_state["incremental_stats"] = {}
    collect_state["_phase_timing_phase"] = None
    collect_state["_phase_timing_started"] = None
    try:
        # Keep runtime logs history between collect sessions so UI logs tab
        # remains useful as a service activity journal.
        try:
            collect_slow.clear()
        except Exception:
            pass
        push_collect_log("starting", "Starting collect…", None, "info")
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None,
            lambda: run_collect_sync(cfg, force_full=force_full),
        )
        collect_state["last_collected_at"] = datetime.now(tz=timezone.utc).isoformat()
    except CollectCancelled:
        logger.info("Collection cancelled by user.")
        collect_state["last_error"] = None
        collect_state["phase"] = "cancelled"
        collect_state["progress_main"] = "Collect cancelled"
        reason = str(collect_state.get("stop_reason") or "cancel_requested")
        collect_state["progress_sub"] = f"Stopped by user ({reason})"
        try:
            push_collect_log("cancelled", "Collect stopped by user", f"reason={reason}", "warn")
        except Exception:
            pass
    except Exception as exc:
        logger.exception("Collection failed: %s", exc)
        collect_state["last_error"] = str(exc)
    finally:
        try:
            p = collect_state.get("_phase_timing_phase")
            st = collect_state.get("_phase_timing_started")
            if p and st:
                elapsed_ms = max(0, int((time.monotonic() - float(st)) * 1000))
                timings = collect_state.setdefault("phase_timings_ms", {})
                timings[p] = int(timings.get(p, 0) or 0) + elapsed_ms
        except Exception:
            pass
        collect_state["_phase_timing_phase"] = None
        collect_state["_phase_timing_started"] = None
        collect_state["cancel_requested"] = False
        collect_state["is_collecting"] = False
        collect_state["started_at"] = None
        try:
            await sse_broadcast_async(
                {
                    "type": "collect_done",
                    "last_collected_at": collect_state.get("last_collected_at"),
                    "error": collect_state.get("last_error"),
                    "revision": data_revision,
                }
            )
        except Exception:
            pass


async def collect_loop(
    cfg: dict,
    *,
    auto_collect_enabled_getter: Callable[[], bool],
    interval_seconds_getter: Callable[[], int],
    do_collect_fn: Callable[[dict], Awaitable[None]],
) -> None:
    """Collect immediately on start, then repeat every interval.

    ``auto_collect_enabled_getter`` is unused: the loop runs for the lifetime of the task
    (task is only started when background collect is enabled in config / lifespan).
    """
    _ = auto_collect_enabled_getter  # kept for call-site compatibility
    while True:
        interval = int(interval_seconds_getter() or 300)
        await do_collect_fn(cfg)  # force_full is decided by the wrapper bound in app.py
        await asyncio.sleep(max(5, interval))
