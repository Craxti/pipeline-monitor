"""Snapshot JSON read path + short-lived in-memory cache (tied to data revision + file mtime)."""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Callable, Optional

from models.models import CISnapshot

logger = logging.getLogger(__name__)

SNAPSHOT_PATH = Path("data") / "snapshot.json"

_SNAPSHOT_CACHE_TTL_SEC = 2.0
_snapshot_cache_snap: CISnapshot | None = None
_snapshot_cache_rev: int = -1
_snapshot_cache_mtime: float | None = None
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
    global _snapshot_cache_mtime, _snapshot_cache_expires_mono
    _snapshot_cache_snap = None
    _snapshot_cache_rev = -1
    _snapshot_cache_mtime = None
    _snapshot_cache_expires_mono = 0.0


def prime_snapshot_cache(snapshot: CISnapshot, mtime: float | None = None) -> None:
    """Seed cache with a known snapshot + file mtime."""
    global _snapshot_cache_snap, _snapshot_cache_rev
    global _snapshot_cache_mtime, _snapshot_cache_expires_mono
    _snapshot_cache_snap = snapshot
    _snapshot_cache_rev = _current_revision()
    if mtime is None:
        try:
            _snapshot_cache_mtime = SNAPSHOT_PATH.stat().st_mtime
        except OSError:
            _snapshot_cache_mtime = None
    else:
        _snapshot_cache_mtime = mtime
    _snapshot_cache_expires_mono = time.monotonic() + _SNAPSHOT_CACHE_TTL_SEC


def load_snapshot() -> CISnapshot | None:
    """Load snapshot JSON, using short-lived in-memory cache when possible."""
    if not SNAPSHOT_PATH.exists():
        invalidate_snapshot_cache()
        return None
    try:
        st = SNAPSHOT_PATH.stat()
    except OSError:
        invalidate_snapshot_cache()
        return None
    mtime = st.st_mtime
    mon = time.monotonic()
    rev = _current_revision()
    if (
        _snapshot_cache_snap is not None
        and _snapshot_cache_rev == rev
        and _snapshot_cache_mtime == mtime
        and mon < _snapshot_cache_expires_mono
    ):
        return _snapshot_cache_snap
    try:
        snap = CISnapshot.model_validate_json(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.error("Failed to load snapshot: %s", exc)
        invalidate_snapshot_cache()
        return None
    prime_snapshot_cache(snap, mtime)
    return snap


async def load_snapshot_async() -> CISnapshot | None:
    """Threaded wrapper around `load_snapshot`."""
    return await asyncio.to_thread(load_snapshot)
