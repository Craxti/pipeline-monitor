"""Dedicated thread pool for long-running collect cycles.

The default ``asyncio`` executor is shared with ``asyncio.to_thread`` used by API
handlers (snapshot load, status, exports). Running collect there can starve the
pool and make the dashboard appear hung while collection runs.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Optional

_executor: Optional[ThreadPoolExecutor] = None


def get_collect_executor() -> ThreadPoolExecutor:
    """Return the singleton collect executor (one worker — collect is single-flight)."""
    global _executor
    if _executor is None:
        _executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="collect-main")
    return _executor


def shutdown_collect_executor() -> None:
    """Release the collect executor (app shutdown)."""
    global _executor
    if _executor is None:
        return
    _executor.shutdown(wait=False)
    _executor = None
