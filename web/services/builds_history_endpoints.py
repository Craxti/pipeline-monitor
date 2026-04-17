from __future__ import annotations

import logging
from typing import Any, Callable

from fastapi import HTTPException

logger = logging.getLogger(__name__)


def api_builds_history(
    *,
    sqlite_available: bool,
    db_query_builds_history: Callable[..., dict] | None,
    page: int,
    per_page: int,
    job: str,
    source: str,
    status: str,
    days: int,
) -> dict:
    if (not sqlite_available) or db_query_builds_history is None:
        return {
            "items": [],
            "page": page,
            "per_page": per_page,
            "total": 0,
            "has_more": False,
            "source": "none",
            "note": "sqlite_unavailable",
        }
    try:
        data = db_query_builds_history(
            job=job,
            source=source,
            status=status,
            page=max(1, page),
            per_page=min(max(1, per_page), 200),
            days=min(max(1, days), 365),
        )
    except Exception as exc:
        logger.warning("api_builds_history: %s", exc)
        raise HTTPException(500, str(exc)) from exc
    data["page"] = max(1, page)
    data["per_page"] = min(max(1, per_page), 200)
    data["source"] = "sqlite"
    return data

