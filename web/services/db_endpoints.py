from __future__ import annotations

from typing import Any, Callable


def api_db_stats(*, sqlite_available: bool, db_stats: Callable[[], Any]) -> Any:
    if not sqlite_available:
        return {"enabled": False, "reason": "db.py module not loaded"}
    return db_stats()

