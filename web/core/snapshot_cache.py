"""Snapshot read path + short-lived in-memory cache (tied to data revision + DB store_seq)."""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Callable, Optional

from models.models import CISnapshot

logger = logging.getLogger(__name__)

# Legacy on-disk location (no longer read/written by the app; data lives in ``monitor.db``).
# Kept ONLY as a reference for migration/troubleshooting.
SNAPSHOT_JSON_LEGACY_PATH = Path("data") / "snapshot.json"

_SNAPSHOT_CACHE_TTL_SEC = 2.0
_snapshot_cache_snap: CISnapshot | None = None
_snapshot_cache_rev: int = -1
_snapshot_cache_store_seq: int | None = None
_snapshot_cache_expires_mono: float = 0.0

_revision_accessor: Optional[Callable[[], int]] = None


def set_snapshot_revision_accessor(fn: Callable[[], int]) -> None:
    """Call once from ``web.app`` after ``_data_revision`` is defined."""
    global _revision_accessor
    _revision_accessor = fn


def _current_revision() -> int:
    fn = _revision_accessor
    if fn is None:
        return 0
    try:
        return int(fn())
    except Exception:
        return 0


def invalidate_snapshot_cache() -> None:
    """Clear in-memory snapshot cache."""
    global _snapshot_cache_snap, _snapshot_cache_rev
    global _snapshot_cache_store_seq, _snapshot_cache_expires_mono
    _snapshot_cache_snap = None
    _snapshot_cache_rev = -1
    _snapshot_cache_store_seq = None
    _snapshot_cache_expires_mono = 0.0


def prime_snapshot_cache(snapshot: CISnapshot, store_seq: int | None = None) -> None:
    """Seed cache with a known snapshot + DB ``store_seq`` (from ``set_latest_snapshot_json``)."""
    global _snapshot_cache_snap, _snapshot_cache_rev
    global _snapshot_cache_store_seq, _snapshot_cache_expires_mono
    _snapshot_cache_snap = snapshot
    _snapshot_cache_rev = _current_revision()
    _snapshot_cache_store_seq = store_seq
    _snapshot_cache_expires_mono = time.monotonic() + _SNAPSHOT_CACHE_TTL_SEC


def load_snapshot() -> CISnapshot | None:
    """Load latest snapshot from SQLite ``meta``, using short-lived in-memory cache."""
    try:
        from web.db import (
            ensure_database_initialized,
            get_latest_snapshot_raw,
            get_latest_snapshot_store_seq,
        )
    except ImportError:
        invalidate_snapshot_cache()
        return None

    if not ensure_database_initialized():
        invalidate_snapshot_cache()
        return None

    mon = time.monotonic()
    rev = _current_revision()
    try:
        seq_probe = get_latest_snapshot_store_seq()
    except Exception as exc:
        logger.error("Failed to load snapshot: %s", exc)
        invalidate_snapshot_cache()
        return None

    if (
        _snapshot_cache_snap is not None
        and _snapshot_cache_rev == rev
        and _snapshot_cache_store_seq == seq_probe
        and mon < _snapshot_cache_expires_mono
    ):
        return _snapshot_cache_snap

    try:
        raw, seq = get_latest_snapshot_raw()
    except Exception as exc:
        logger.error("Failed to load snapshot: %s", exc)
        invalidate_snapshot_cache()
        return None

    if not raw:
        invalidate_snapshot_cache()
        return None

    try:
        snap = CISnapshot.model_validate_json(raw)
    except Exception as exc:
        logger.error("Failed to load snapshot: %s", exc)
        invalidate_snapshot_cache()
        return None
    prime_snapshot_cache(snap, seq)
    return snap


async def load_snapshot_async() -> CISnapshot | None:
    """Threaded wrapper around `load_snapshot`."""
    return await asyncio.to_thread(load_snapshot)
