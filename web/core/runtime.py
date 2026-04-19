"""
Shared runtime state for the web process.

Goal: keep FastAPI composition (web/app.py) thin and allow route modules to depend on
runtime state without importing web.app (avoids circular imports).
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any

from web.core import snapshot_cache as _snapshot_cache_mod
from web.core import event_feed as _event_feed_mod
from web.core import trends as _trends_mod

from web.services.collect_state import CollectState as _CollectState
from web.services.notification_state import NotificationState as _NotificationState

from web.services import collect_runtime_state as _collect_runtime_state
from web.services import event_feed_runtime as _event_feed_runtime
from web.services import instance_health_runtime as _instance_health_runtime
from web.services import mem_cache_runtime as _mem_cache_runtime
from web.services import notify_runtime as _notify_runtime
from web.services import rate_limit_runtime as _rate_limit_runtime
from web.services import revision_state as _revision_state
from web.services import sse_runtime as _sse_runtime
from web.services import auto_collect_runtime as _auto_collect_runtime


# ---- Constants from core modules
EVENT_FEED_MAX = _event_feed_mod.EVENT_FEED_MAX
HISTORY_MAX_DAYS = _trends_mod.HISTORY_MAX_DAYS


# ---- Snapshot store locks / partial snapshot throttle
snapshot_write_lock = threading.Lock()
partial_last_write_ts_ref: dict[str, float] = {"ts": 0.0}


# ---- Revision / caching
revision_rt = _revision_state.RevisionState()
_revision_state.register_snapshot_revision_accessor(
    snapshot_cache_mod=_snapshot_cache_mod,
    get_revision=lambda: revision_rt.revision,
)

load_snapshot = _snapshot_cache_mod.load_snapshot
load_snapshot_async = _snapshot_cache_mod.load_snapshot_async
prime_snapshot_cache = _snapshot_cache_mod.prime_snapshot_cache


# ---- Main loop (set at lifespan startup)
main_loop: asyncio.AbstractEventLoop | None = None

# ---- Auto-collect toggle state (LIVE mode)
auto_collect_rt = _auto_collect_runtime.AutoCollectRuntime()


# ---- SSE
sse_rt = _sse_runtime.SSERuntime()


# ---- In-memory TTL cache
mem_cache_rt = _mem_cache_runtime.MemCacheRuntime()


# ---- Collect runtime state/logs
collect_rt_state = _collect_runtime_state.make_collect_runtime_state(_CollectState)
collect_state = collect_rt_state.state
collect_logs = collect_rt_state.logs
collect_slow = collect_rt_state.slow


# ---- Instance health (last collect per-source status)
instance_health_rt = _instance_health_runtime.InstanceHealthRuntime()


# ---- Rate limiting store
rate_limit_rt = _rate_limit_runtime.RateLimitRuntime()


# ---- Notifications / event feed
notify_state = _notify_runtime.make_notify_state(_NotificationState, notify_max=200)
event_feed_rt = _event_feed_runtime.EventFeedRuntime(
    path=None,
    max_entries=EVENT_FEED_MAX,
)


def bump_revision() -> int:
    """Increase data revision counter; used for cache invalidation."""
    return revision_rt.bump()


def get_instance_health() -> list[dict[str, Any]]:
    """Return per-instance health snapshot for API responses."""
    return _instance_health_runtime.get_health(instance_health_rt)


def set_instance_health(h: list[dict[str, Any]]) -> None:
    """Replace per-instance health snapshot."""
    return _instance_health_runtime.set_health(instance_health_rt, h)
