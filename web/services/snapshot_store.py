"""Low-level snapshot persistence helpers (JSON file + optional SQLite)."""

from __future__ import annotations

from typing import Any, Callable


def save_snapshot(
    snapshot: Any,
    *,
    snapshot_write_lock,
    data_file,
    prime_snapshot_cache: Callable[[Any, float | None], None],
    append_trends: Callable[[Any], None],
    detect_state_changes: Callable[[Any], None],
    sqlite_available: bool,
    db_append: Callable[[Any], None] | None,
    bump_revision: Callable[[], int],
    logger_warning: Callable[[str, object], None],
    logger_debug: Callable[[str, object], None],
) -> None:
    """Persist a full snapshot, bump revision, and run hooks."""
    with snapshot_write_lock:
        data_file.parent.mkdir(parents=True, exist_ok=True)
        data_file.write_text(snapshot.model_dump_json(indent=2), encoding="utf-8")
        bump_revision()
        try:
            mtime = data_file.stat().st_mtime
        except OSError:
            mtime = None
        prime_snapshot_cache(snapshot, mtime)
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
    data_file,
    prime_snapshot_cache: Callable[[Any, float | None], None],
    bump_revision: Callable[[], int],
    collect_state: dict,
    load_snapshot: Callable[[], Any],
) -> None:
    """
    Persist an in-progress snapshot for live dashboard updates during Collect.
    Intentionally skips trends/notifications/DB to keep it cheap.
    """
    try:
        if collect_state.get("is_collecting"):
            n_new = len(getattr(snapshot, "tests", None) or [])
            if n_new == 0:
                prev = load_snapshot()
                if prev is not None and len(getattr(prev, "tests", None) or []) > 0:
                    return
    except Exception:
        pass

    with snapshot_write_lock:
        data_file.parent.mkdir(parents=True, exist_ok=True)
        data_file.write_text(snapshot.model_dump_json(indent=2), encoding="utf-8")
        bump_revision()
        try:
            mtime = data_file.stat().st_mtime
        except OSError:
            mtime = None
        prime_snapshot_cache(snapshot, mtime)
