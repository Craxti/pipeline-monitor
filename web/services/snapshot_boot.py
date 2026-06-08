"""Boot-time restore of the latest persisted snapshot from SQLite."""

from __future__ import annotations

import logging
from typing import Any

from models.models import CISnapshot

_persisted_baseline_snap: CISnapshot | None = None


def prime_persisted_baseline_cache(snapshot: CISnapshot | None) -> None:
    """Remember last good DB snapshot for collect-time patching (no SQLite on hot path)."""
    global _persisted_baseline_snap
    _persisted_baseline_snap = snapshot


def get_persisted_baseline_cached() -> CISnapshot | None:
    return _persisted_baseline_snap


def warm_runtime_snapshot_from_db(*, collect_state: dict | None, logger: logging.Logger | None) -> CISnapshot | None:
    """
    Prime the in-memory snapshot cache from ``monitor.db`` before the first collect.

    Keeps the dashboard populated with the last successful collect after a process restart.
    """
    log = logger or logging.getLogger(__name__)
    try:
        from web.core.snapshot_cache import invalidate_snapshot_cache, load_snapshot, prime_snapshot_cache

        invalidate_snapshot_cache()
        snap = load_snapshot()
        if snap is None:
            snap = load_persisted_snapshot_baseline()
            if snap is not None:
                prime_snapshot_cache(snap)
    except Exception as exc:
        log.warning("Snapshot warm-from-DB skipped: %s", exc)
        return None

    if snap is None:
        prime_persisted_baseline_cache(None)
        log.info("No persisted snapshot in DB — UI will populate after the first collect.")
        return None

    prime_persisted_baseline_cache(snap)

    n_b = len(getattr(snap, "builds", None) or [])
    n_t = len(getattr(snap, "tests", None) or [])
    n_s = len(getattr(snap, "services", None) or [])
    log.info("Restored snapshot from DB: builds=%d tests=%d services=%d", n_b, n_t, n_s)

    if collect_state is not None and not collect_state.get("last_collected_at"):
        collected = getattr(snap, "collected_at", None)
        if collected is not None:
            try:
                if hasattr(collected, "isoformat"):
                    ts = collected.isoformat()
                    if getattr(collected, "tzinfo", None) is None and not ts.endswith("Z"):
                        ts = ts + "+00:00"
                else:
                    ts = str(collected)
                collect_state["last_collected_at"] = ts
            except Exception:
                pass

    return snap


def load_persisted_snapshot_baseline() -> CISnapshot | None:
    """Return boot-time baseline snapshot (memory only; avoids SQLite during collect)."""
    cached = get_persisted_baseline_cached()
    if cached is not None:
        return cached
    snap = _load_persisted_snapshot_from_db()
    if snap is not None:
        prime_persisted_baseline_cache(snap)
    return snap


def _load_persisted_snapshot_from_db() -> CISnapshot | None:
    """Read the latest snapshot document from SQLite (ignores the live cache)."""
    try:
        from web.db import ensure_database_initialized, get_latest_snapshot_raw
    except ImportError:
        return None
    if not ensure_database_initialized():
        return None
    try:
        raw, _seq = get_latest_snapshot_raw()
    except Exception:
        return None
    if not raw:
        return None
    try:
        return CISnapshot.model_validate_json(raw)
    except Exception:
        return None
