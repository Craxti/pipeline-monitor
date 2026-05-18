"""
Entrypoints for collect/snapshot that should not live in `web.app`.

This module is safe to import from route handlers without pulling in FastAPI app wiring.
"""

from __future__ import annotations

import logging
from models.models import CISnapshot, TestRecord

from web.core import runtime as rt
from web.core import trends as trends_mod
from web.core.config import load_yaml_config

from web.services import collect_loop as collect_loop_mod
from web.services import collect_orchestrator
from web.services import collect_tasks
from web.services import notify_runtime
from web.services import snapshot_api
from web.services import sqlite_imports as _db_opt
from web.services import sse_hub
from web.services import sse_runtime
from web.services.build_filters import config_instance_label as _config_instance_label
from web.services.build_filters import inst_label_for_build_with_cfg as _inst_label_for_build_with_cfg
from web.services.collect_sync import run_collect_sync as _collect_sync_run_mod

logger = logging.getLogger(__name__)


SQLITE_AVAILABLE = bool(_db_opt.SQLITE_AVAILABLE)
_db_append = _db_opt.append_snapshot
get_collector_state_int = _db_opt.get_collector_state_int
set_collector_state_int = _db_opt.set_collector_state_int


def _append_trends(snapshot: CISnapshot) -> None:
    """Append trends bucket to history."""
    return snapshot_api.append_trends(
        snapshot,
        trends_mod=trends_mod,
        history_path=None,
        history_max_days=rt.HISTORY_MAX_DAYS,
        load_cfg=load_yaml_config,
        inst_label_for_build=_inst_label_for_build_with_cfg,
    )


def save_snapshot(snapshot: CISnapshot, *, data_dir: str | None = None) -> None:
    """Persist a full snapshot to SQLite ``meta`` (+ historical rows if available)."""
    return snapshot_api.save_snapshot(
        snapshot,
        snapshot_write_lock=rt.snapshot_write_lock,
        data_dir=data_dir,
        prime_snapshot_cache=rt.prime_snapshot_cache,
        append_trends_fn=_append_trends,
        detect_state_changes=detect_state_changes,
        sqlite_available=bool(SQLITE_AVAILABLE),
        db_append=_db_append if SQLITE_AVAILABLE else None,
        bump_revision=rt.bump_revision,
        logger=logger,
    )


def save_snapshot_partial(snapshot: CISnapshot, *, data_dir: str | None = None) -> None:
    """Persist partial snapshot used during long collect cycles."""
    return snapshot_api.save_snapshot_partial(
        snapshot,
        snapshot_write_lock=rt.snapshot_write_lock,
        data_dir=data_dir,
        prime_snapshot_cache=rt.prime_snapshot_cache,
        bump_revision=rt.bump_revision,
        collect_state=rt.collect_state,
        load_snapshot=rt.load_snapshot,
    )


def maybe_save_partial(
    snapshot: CISnapshot,
    *,
    min_interval_s: float = 2.0,
    force: bool = False,
) -> None:
    """Save partial snapshot if enough time passed (throttled)."""
    return snapshot_api.maybe_save_partial(
        snapshot,
        last_write_ts_ref=rt.partial_last_write_ts_ref,
        min_interval_s=min_interval_s,
        force=force,
        save_snapshot_partial_fn=save_snapshot_partial,
        logger=logger,
    )


def detect_state_changes(snapshot: CISnapshot) -> None:
    """Detect changes and append notifications + persisted events."""

    # `notify_state` object lives in runtime; keep it the same
    def _append_event(entries: list[dict]) -> None:
        from web.services import event_feed_api

        return event_feed_api.append(
            entries,
            path=None,
            max_entries=rt.EVENT_FEED_MAX,
        )

    return notify_runtime.detect_state_changes(
        rt.notify_state,
        snapshot,
        append_event=_append_event,
    )


def set_instance_health(h: list[dict]) -> None:
    """Update instance health snapshot."""
    return rt.set_instance_health(h)


def push_collect_log(
    phase: str,
    main: str,
    sub: str | None = None,
    level: str = "info",
) -> None:
    """Push a collect log entry into runtime state."""
    return rt.collect_rt_state.push_log(phase, main, sub, level)


async def sse_broadcast_async(payload: dict) -> None:
    """Broadcast payload to SSE subscribers."""
    return await sse_runtime.broadcast_async(sse_hub, rt.sse_rt, payload)


def run_collect_sync(cfg: dict, *, force_full: bool = False) -> None:
    """Run one sync collect cycle (blocking)."""
    if not SQLITE_AVAILABLE or get_collector_state_int is None or set_collector_state_int is None:
        # fallback no-op state fns
        def _get(*_a, **_k) -> int:
            return 0

        def _set(*_a, **_k) -> None:
            return None

    else:
        _get = get_collector_state_int
        _set = set_collector_state_int

    return collect_orchestrator.run_collect_sync(
        cfg,
        force_full=force_full,
        collect_sync_run_mod=_collect_sync_run_mod,
        CISnapshot=CISnapshot,
        TestRecord=TestRecord,
        load_snapshot=rt.load_snapshot,
        save_snapshot=save_snapshot,
        maybe_save_partial=maybe_save_partial,
        collect_state=rt.collect_state,
        push_collect_log=push_collect_log,
        collect_slow=rt.collect_slow,
        instance_health_setter=set_instance_health,
        config_instance_label=_config_instance_label,
        sqlite_available=bool(SQLITE_AVAILABLE),
        get_collector_state_int=_get,
        set_collector_state_int=_set,
        logger=logger,
    )


async def do_collect(cfg: dict, *, force_full: bool = False) -> None:
    """Run one async collect cycle (used by endpoints)."""
    return await collect_tasks.do_collect(
        cfg,
        force_full=force_full,
        collect_loop_mod=collect_loop_mod,
        collect_state=rt.collect_state,
        collect_logs=rt.collect_logs,
        collect_slow=rt.collect_slow,
        push_collect_log=push_collect_log,
        run_collect_sync=run_collect_sync,
        sse_broadcast_async=sse_broadcast_async,
        data_revision=rt.revision_rt.revision,
    )


async def collect_loop(cfg: dict) -> None:
    """Background collect loop runner."""
    return await collect_loop_mod.collect_loop(
        cfg,
        auto_collect_enabled_getter=lambda: bool(rt.auto_collect_rt.enabled),
        interval_seconds_getter=lambda: int(rt.collect_state.get("interval_seconds") or 300),
        do_collect_fn=lambda c: do_collect(c, force_full=False),
    )
