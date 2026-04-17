"""Wiring for public settings payload builder."""

from __future__ import annotations


def public_settings_payload(cfg: dict, *, sqlite_available: bool, db_stats) -> dict:
    """Build settings payload safe for UI exposure."""
    from web.services import public_settings as _public_settings

    return _public_settings.public_settings_payload(
        cfg,
        sqlite_available=sqlite_available,
        db_stats=db_stats if sqlite_available else None,
    )
