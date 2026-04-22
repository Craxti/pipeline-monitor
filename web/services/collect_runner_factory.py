"""Shared factory helpers for collect route wiring."""

from __future__ import annotations

import asyncio
from collections.abc import Callable

from web.services import collect_entrypoints


def create_do_collect_task_factory(*, force_full: bool = False) -> Callable[[dict], asyncio.Task]:
    """Return a task factory for one-off collect runs."""

    def _factory(cfg: dict) -> asyncio.Task:
        return asyncio.create_task(collect_entrypoints.do_collect(cfg, force_full=force_full))

    return _factory


def create_trigger_collect_task_factory() -> Callable[[dict, bool], asyncio.Task]:
    """Return a task factory for manual trigger endpoint with dynamic force_full."""

    def _factory(cfg: dict, force_full: bool) -> asyncio.Task:
        return asyncio.create_task(collect_entrypoints.do_collect(cfg, force_full=force_full))

    return _factory


def create_collect_loop_task(cfg: dict) -> asyncio.Task:
    """Return background collect loop task."""
    return asyncio.create_task(
        collect_entrypoints.collect_loop(
            cfg,
        )
    )


