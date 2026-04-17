"""Wiring wrapper for snapshot persistence."""

from __future__ import annotations


def save_snapshot(
    snapshot,
    *,
    snapshot_write_lock,
    data_file: str,
    prime_snapshot_cache,
    append_trends,
    detect_state_changes,
    sqlite_available: bool,
    db_append,
    bump_revision,
    logger_warning,
    logger_debug,
):
    """Delegate snapshot saving to `web.services.snapshot_store`."""
    from web.services import snapshot_store as _snapshot_store

    return _snapshot_store.save_snapshot(
        snapshot,
        snapshot_write_lock=snapshot_write_lock,
        data_file=data_file,
        prime_snapshot_cache=prime_snapshot_cache,
        append_trends=append_trends,
        detect_state_changes=detect_state_changes,
        sqlite_available=sqlite_available,
        db_append=db_append if sqlite_available else None,
        bump_revision=bump_revision,
        logger_warning=logger_warning,
        logger_debug=logger_debug,
    )
