"""Compatibility wrapper for public settings payload."""

from __future__ import annotations


def public_settings_payload(cfg: dict) -> dict:
    """Build public settings payload with optional SQLite stats."""
    try:
        from web.db import db_stats

        sqlite_available = True
    except ImportError:
        try:
            from db import db_stats  # type: ignore

            sqlite_available = True
        except ImportError:
            sqlite_available = False
            db_stats = None  # type: ignore

    from web.services import public_settings_wiring as _public_settings_wiring

    return _public_settings_wiring.public_settings_payload(
        cfg,
        sqlite_available=sqlite_available,
        db_stats=db_stats if sqlite_available else None,
    )
