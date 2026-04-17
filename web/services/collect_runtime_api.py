from __future__ import annotations

import asyncio
from collections.abc import Callable

from web.core import runtime as rt


def push_collect_log(phase: str, main: str, sub: str | None = None, level: str = "info") -> None:
    return rt.collect_rt_state.push_log(phase, main, sub, level)


async def sse_broadcast_async(sse_hub_mod, payload: dict) -> None:
    return await sse_hub_mod.broadcast_async(rt.sse_rt.queues, payload)


def set_instance_health(h: list[dict]) -> None:
    return rt.set_instance_health(h)


def run_collect_sync(
    cfg: dict,
    *,
    force_full: bool,
    collect_sync_run_mod,
    CISnapshot,
    TestRecord,
    config_instance_label,
    sqlite_available: bool,
    get_collector_state_int,
    set_collector_state_int,
    logger,
    load_snapshot,
    save_snapshot,
    maybe_save_partial,
):
    return collect_sync_run_mod.run_collect_sync(
        cfg,
        force_full=force_full,
        CISnapshot=CISnapshot,
        TestRecord=TestRecord,
        load_snapshot=load_snapshot,
        save_snapshot=save_snapshot,
        maybe_save_partial=maybe_save_partial,
        collect_state=rt.collect_state,
        push_collect_log=push_collect_log,
        collect_slow=rt.collect_slow,
        instance_health_setter=set_instance_health,
        config_instance_label=config_instance_label,
        sqlite_available=sqlite_available,
        get_collector_state_int=get_collector_state_int,
        set_collector_state_int=set_collector_state_int,
        logger=logger,
    )


def do_collect_task_factory(
    do_collect_fn: Callable[[dict, bool], "asyncio.Future[None]"],
) -> Callable[[dict, bool], asyncio.Task]:
    def _factory(cfg: dict, force_full: bool) -> asyncio.Task:
        return asyncio.create_task(do_collect_fn(cfg, force_full))

    return _factory

