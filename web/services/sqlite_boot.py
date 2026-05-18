"""SQLite initialization helper."""

from __future__ import annotations

from pathlib import Path


def init_sqlite_if_available(*, cfg: dict, sqlite_available: bool, init_db, logger) -> None:
    """Initialize SQLite DB if SQLite layer is available."""
    if not sqlite_available:
        return
    data_dir = Path(cfg.get("general", {}).get("data_dir", "data"))
    try:
        init_db(data_dir)
        logger.info("SQLite history DB initialized at %s", data_dir / "monitor.db")
    except Exception as exc:
        logger.warning("SQLite init failed (non-fatal): %s", exc)
