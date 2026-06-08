"""Low-level snapshot persistence (SQLite ``meta`` + optional historical SQLite rows)."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Callable

_COLLECT_SSE_TS_REF: dict[str, float] = {"ts": 0.0}
_COLLECT_SSE_MIN_INTERVAL_S = 0.45


def _patch_snapshot_for_collect_publish(snapshot: Any, collect_state: dict) -> Any:
    """Merge shrinking in-progress sections with the last good snapshot (cache or DB)."""
    if not collect_state.get("is_collecting"):
        return snapshot
    prev = None
    try:
        from web.core.snapshot_cache import peek_snapshot_cache

        prev = peek_snapshot_cache()
    except Exception:
        prev = None
    if prev is None:
        try:
            from web.services.snapshot_boot import get_persisted_baseline_cached

            prev = get_persisted_baseline_cached()
        except Exception:
            prev = None
    if prev is None:
        return snapshot
    cur_builds = list(getattr(snapshot, "builds", None) or [])
    cur_tests = list(getattr(snapshot, "tests", None) or [])
    cur_services = list(getattr(snapshot, "services", None) or [])
    prev_builds = list(getattr(prev, "builds", None) or [])
    prev_tests = list(getattr(prev, "tests", None) or [])
    prev_services = list(getattr(prev, "services", None) or [])

    patch_builds = len(prev_builds) > 0 and len(cur_builds) < len(prev_builds)
    patch_tests = len(prev_tests) > 0 and len(cur_tests) < len(prev_tests)
    patch_services = len(prev_services) > 0 and len(cur_services) < len(prev_services)
    if not (patch_builds or patch_tests or patch_services):
        return snapshot
    patch: dict[str, list] = {}
    if patch_builds:
        patch["builds"] = prev_builds
    if patch_tests:
        patch["tests"] = prev_tests
    if patch_services:
        patch["services"] = prev_services
    return snapshot.model_copy(update=patch)


def _sse_broadcast_collect_sync(payload: dict) -> None:
    """Best-effort SSE push from the sync collect thread."""
    try:
        import asyncio

        from web.core import runtime as rt
        from web.services import sse_hub

        loop = rt.main_loop
        if loop is None or not loop.is_running():
            return
        asyncio.run_coroutine_threadsafe(
            sse_hub.broadcast_async(rt.sse_rt.queues, payload),
            loop,
        )
    except Exception:
        pass


def _maybe_broadcast_collect_snapshot_sse(snapshot: Any, collect_state: dict) -> None:
    if not collect_state.get("is_collecting"):
        return
    now = time.monotonic()
    last = float(_COLLECT_SSE_TS_REF.get("ts", 0.0) or 0.0)
    if now - last < _COLLECT_SSE_MIN_INTERVAL_S:
        return
    _COLLECT_SSE_TS_REF["ts"] = now
    try:
        from web.core import runtime as rt

        counts = {
            "builds": len(getattr(snapshot, "builds", None) or []),
            "tests": len(getattr(snapshot, "tests", None) or []),
            "services": len(getattr(snapshot, "services", None) or []),
        }
        _sse_broadcast_collect_sync(
            {
                "type": "snapshot_partial",
                "revision": rt.revision_rt.revision,
                "counts": counts,
                "phase": collect_state.get("phase"),
                "active_phases": list(collect_state.get("active_phases") or []),
            }
        )
    except Exception:
        pass


def touch_collect_snapshot_live(
    snapshot: Any,
    *,
    prime_snapshot_cache: Callable[[Any, int | None], None],
    bump_revision: Callable[[], int] | None = None,
    collect_state: dict,
) -> None:
    """Refresh in-memory snapshot during collect and notify SSE clients (throttled)."""
    if not collect_state.get("is_collecting"):
        return
    snapshot_to_publish = _patch_snapshot_for_collect_publish(snapshot, collect_state)
    if bump_revision is not None:
        try:
            bump_revision()
        except Exception:
            pass
    try:
        prime_snapshot_cache(snapshot_to_publish, store_seq=None)
    except Exception:
        pass
    _maybe_broadcast_collect_snapshot_sse(snapshot_to_publish, collect_state)


def save_snapshot(
    snapshot: Any,
    *,
    snapshot_write_lock,
    data_dir: str | Path | None,
    prime_snapshot_cache: Callable[[Any, int | None], None],
    append_trends: Callable[[Any], None],
    detect_state_changes: Callable[[Any], None],
    sqlite_available: bool,
    db_append: Callable[[Any], None] | None,
    bump_revision: Callable[[], int],
    logger_warning: Callable[[str, object], None],
    logger_debug: Callable[[str, object], None],
) -> None:
    """Persist a full snapshot, bump revision, and run hooks."""
    from web.db import ensure_database_initialized, set_latest_snapshot_json

    with snapshot_write_lock:
        if not ensure_database_initialized(data_dir=data_dir):
            logger_warning("Snapshot not persisted: SQLite unavailable or init failed")
            return
        seq = set_latest_snapshot_json(snapshot.model_dump_json())
        bump_revision()
        prime_snapshot_cache(snapshot, seq)
        try:
            from web.services.snapshot_boot import prime_persisted_baseline_cache

            prime_persisted_baseline_cache(snapshot)
        except Exception:
            pass
    try:
        append_trends(snapshot)
    except Exception as exc:
        logger_warning("Failed to append trends: %s", exc)
    try:
        detect_state_changes(snapshot)
    except Exception as exc:
        logger_warning("Failed to detect state changes: %s", exc)

    if sqlite_available and db_append is not None:
        try:
            db_append(snapshot)
        except Exception as exc:
            logger_debug("SQLite append skipped: %s", exc)


def save_snapshot_partial(
    snapshot: Any,
    *,
    snapshot_write_lock,
    data_dir: str | Path | None,
    prime_snapshot_cache: Callable[[Any, int | None], None],
    bump_revision: Callable[[], int],
    collect_state: dict,
    load_snapshot: Callable[[], Any],
) -> None:
    """
    Persist an in-progress snapshot for live dashboard updates during Collect.
    Intentionally skips trends/notifications/DB history append to keep it cheap.
    """
    snapshot_to_save = _patch_snapshot_for_collect_publish(snapshot, collect_state)

    if collect_state.get("is_collecting"):
        # Memory-only while collect runs — SQLite writes here block readers and freeze the UI.
        try:
            bump_revision()
        except Exception:
            pass
        try:
            prime_snapshot_cache(snapshot_to_save, store_seq=None)
        except Exception:
            pass
        _maybe_broadcast_collect_snapshot_sse(snapshot_to_save, collect_state)
        return

    try:
        body = snapshot_to_save.model_dump_json()
    except Exception:
        return

    from web.db import ensure_database_initialized, set_latest_snapshot_json

    with snapshot_write_lock:
        if not ensure_database_initialized(data_dir=data_dir):
            return
        seq = set_latest_snapshot_json(body)
        prime_snapshot_cache(snapshot_to_save, seq)
