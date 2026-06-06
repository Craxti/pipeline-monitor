"""Dedicated thread pool for API snapshot/filter work.

Keeps heavy read paths off the default ``asyncio`` executor so a long collect cycle
does not starve dashboard endpoints and make the UI feel frozen.
"""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional, TypeVar

T = TypeVar("T")

_executor: Optional[ThreadPoolExecutor] = None


def get_api_executor() -> ThreadPoolExecutor:
    global _executor
    if _executor is None:
        _executor = ThreadPoolExecutor(max_workers=6, thread_name_prefix="api-worker")
    return _executor


async def run_api_thread(func: Callable[..., T], /, *args, **kwargs) -> T:
    loop = asyncio.get_running_loop()
    if kwargs:
        return await loop.run_in_executor(get_api_executor(), lambda: func(*args, **kwargs))
    return await loop.run_in_executor(get_api_executor(), func, *args)


def shutdown_api_executor() -> None:
    global _executor
    if _executor is not None:
        _executor.shutdown(wait=False, cancel_futures=True)
        _executor = None
