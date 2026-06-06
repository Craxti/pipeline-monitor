"""Parallel execution helpers for sync collectors (instances / hosts)."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Iterable, TypeVar

T = TypeVar("T")


def parallel_instances_enabled(cfg: dict) -> bool:
    """True when multiple CI instances may run in parallel threads."""
    general = cfg.get("general") or {}
    if "parallel_collect_instances" in general:
        return bool(general.get("parallel_collect_instances"))
    # Default on — same spirit as parallel_collect_sources.
    return True


def instance_worker_cap(cfg: dict, n_items: int) -> int:
    """Max worker threads for per-source instance parallelism."""
    general = cfg.get("general") or {}
    raw = general.get("parallel_collect_instance_workers", 6)
    try:
        cap = max(1, int(raw or 6))
    except (TypeError, ValueError):
        cap = 6
    return min(max(1, n_items), cap)


def run_parallel_items(
    items: Iterable[T],
    fn: Callable[[T], None],
    *,
    parallel: bool,
    max_workers: int,
    thread_prefix: str,
) -> None:
    """Run ``fn(item)`` for each item, optionally in a thread pool."""
    work = list(items)
    if not work:
        return
    if not parallel or len(work) == 1:
        for item in work:
            fn(item)
        return
    workers = min(max(1, int(max_workers or 1)), len(work))
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix=thread_prefix) as pool:
        futures = [pool.submit(fn, item) for item in work]
        for fut in futures:
            fut.result()
