"""Tests for parallel collect helpers."""

from __future__ import annotations

from web.services.collect_sync import parallel_util


def test_parallel_instances_enabled_defaults_true() -> None:
    assert parallel_util.parallel_instances_enabled({}) is True
    assert parallel_util.parallel_instances_enabled({"general": {}}) is True
    assert parallel_util.parallel_instances_enabled({"general": {"parallel_collect_instances": False}}) is False


def test_instance_worker_cap() -> None:
    cfg = {"general": {"parallel_collect_instance_workers": 4}}
    assert parallel_util.instance_worker_cap(cfg, 10) == 4
    assert parallel_util.instance_worker_cap(cfg, 2) == 2


def test_run_parallel_items_sequential_when_disabled() -> None:
    seen: list[int] = []

    def _fn(x: int) -> None:
        seen.append(x)

    parallel_util.run_parallel_items([1, 2, 3], _fn, parallel=False, max_workers=4, thread_prefix="t")
    assert seen == [1, 2, 3]


def test_run_parallel_items_parallel() -> None:
    seen: list[int] = []

    def _fn(x: int) -> None:
        seen.append(x)

    parallel_util.run_parallel_items([1, 2, 3], _fn, parallel=True, max_workers=3, thread_prefix="t")
    assert sorted(seen) == [1, 2, 3]
