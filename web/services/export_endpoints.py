from __future__ import annotations

from typing import Any, Awaitable, Callable


async def export_builds(
    *,
    export_builds_fn: Callable[..., Awaitable[Any]],
    load_snapshot: Callable[[], Any],
    fmt: str,
    source: str,
    status: str,
    job: str,
    hours: int,
) -> Any:
    return await export_builds_fn(
        load_snapshot=load_snapshot,
        fmt=fmt,
        source=source,
        status=status,
        job=job,
        hours=hours,
    )


async def export_tests(
    *,
    export_tests_fn: Callable[..., Awaitable[Any]],
    load_snapshot: Callable[[], Any],
    fmt: str,
    status: str,
    suite: str,
    name: str,
    hours: int,
    source: str,
) -> Any:
    return await export_tests_fn(
        load_snapshot=load_snapshot,
        fmt=fmt,
        status=status,
        suite=suite,
        name=name,
        hours=hours,
        source=source,
    )


async def export_failures(
    *,
    export_failures_fn: Callable[..., Awaitable[Any]],
    load_snapshot: Callable[[], Any],
    fmt: str,
    n: int,
    suite: str,
    name: str,
    source: str,
    hours: int,
    days: int,
) -> Any:
    return await export_failures_fn(
        load_snapshot=load_snapshot,
        fmt=fmt,
        n=n,
        suite=suite,
        name=name,
        source=source,
        hours=hours,
        days=days,
    )

