"""Async task wrappers for collection entrypoints."""

from __future__ import annotations

import asyncio
from collections.abc import Callable


async def do_collect(
    cfg: dict,
    *,
    force_full: bool,
    collect_loop_mod,
    collect_state: dict,
    collect_logs: list,
    collect_slow: list,
    push_collect_log: Callable[[str, str, str | None, str], None],
    run_collect_sync: Callable[[dict, bool], None],
    sse_broadcast_async: Callable[[dict], "asyncio.Future[None]"],
    data_revision: int,
) -> None:
    """Delegate to `collect_loop_mod.do_collect` (async wrapper)."""
    return await collect_loop_mod.do_collect(
        cfg,
        force_full=force_full,
        collect_state=collect_state,
        collect_logs=collect_logs,
        collect_slow=collect_slow,
        push_collect_log=push_collect_log,
        run_collect_sync=run_collect_sync,
        sse_broadcast_async=sse_broadcast_async,
        data_revision=data_revision,
    )


def do_collect_task_factory(
    *,
    collect_fn: Callable[[dict, bool], "asyncio.Future[None]"],
) -> Callable[[dict, bool], asyncio.Task]:
    """Create a task factory for the collect coroutine."""

    def _factory(cfg: dict, force_full: bool) -> asyncio.Task:
        return asyncio.create_task(collect_fn(cfg, force_full))

    return _factory
