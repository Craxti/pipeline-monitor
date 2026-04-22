"""Low-level snapshot persistence (SQLite ``meta`` + optional historical SQLite rows)."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable


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
        seq = set_latest_snapshot_json(snapshot.model_dump_json(indent=2))
        bump_revision()
        prime_snapshot_cache(snapshot, seq)
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
    snapshot_to_save = snapshot
    try:
        # During collect, never publish a partial snapshot that would blank an entire table
        # after page refresh. If current section is empty but previous snapshot had data,
        # keep previous section in the partial view (without mutating live collect object).
        if collect_state.get("is_collecting"):
            prev = load_snapshot()
            if prev is not None:
                cur_builds = list(getattr(snapshot, "builds", None) or [])
                cur_tests = list(getattr(snapshot, "tests", None) or [])
                cur_services = list(getattr(snapshot, "services", None) or [])
                prev_builds = list(getattr(prev, "builds", None) or [])
                prev_tests = list(getattr(prev, "tests", None) or [])
                prev_services = list(getattr(prev, "services", None) or [])

                patch_builds = (len(cur_builds) == 0 and len(prev_builds) > 0)
                patch_tests = (len(cur_tests) == 0 and len(prev_tests) > 0)
                patch_services = (len(cur_services) == 0 and len(prev_services) > 0)

                if patch_builds or patch_tests or patch_services:
                    snapshot_to_save = snapshot.model_copy(deep=True)
                    if patch_builds:
                        snapshot_to_save.builds = prev_builds
                    if patch_tests:
                        snapshot_to_save.tests = prev_tests
                    if patch_services:
                        snapshot_to_save.services = prev_services
    except Exception:
        snapshot_to_save = snapshot

    from web.db import ensure_database_initialized, set_latest_snapshot_json

    with snapshot_write_lock:
        if not ensure_database_initialized(data_dir=data_dir):
            return
        seq = set_latest_snapshot_json(snapshot_to_save.model_dump_json(indent=2))
        bump_revision()
        prime_snapshot_cache(snapshot_to_save, seq)
