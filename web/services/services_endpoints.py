from __future__ import annotations

import json
from typing import Any, Awaitable, Callable

from fastapi import HTTPException


async def api_services(
    *,
    load_snapshot_async: Callable[[], Awaitable[Any]],
    normalize_service_status: Callable[[str], str],
    page: int,
    per_page: int,
    status: str,
) -> dict:
    snap = await load_snapshot_async()
    if snap is None:
        raise HTTPException(404, "No snapshot data found.")

    items = snap.services
    if status:
        raw = (status or "").strip().lower()
        if raw == "problems":
            items = [s for s in items if s.status_normalized in ("down", "degraded")]
        else:
            want = normalize_service_status(status)
            items = [s for s in items if s.status_normalized == want]

    total = len(items)
    start = (page - 1) * per_page
    end = start + per_page
    return {
        "items": [json.loads(s.model_dump_json()) for s in items[start:end]],
        "page": page,
        "per_page": per_page,
        "total": total,
        "has_more": end < total,
    }

