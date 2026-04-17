from __future__ import annotations

from typing import Any, Callable

from fastapi.responses import JSONResponse


def api_trends(
    *,
    days: int,
    data_revision: int,
    mem_cache_get: Callable[[str], Any | None],
    mem_cache_set: Callable[[str, Any], None],
    trends_compute: Callable[[int], Any],
) -> JSONResponse:
    cache_key = f"trends:{days}:{data_revision}"
    cached = mem_cache_get(cache_key)
    if cached is not None:
        return JSONResponse(
            content=cached,
            headers={
                "ETag": f'W/"tr-{data_revision}-{days}"',
                "Cache-Control": "private, max-age=15",
            },
        )
    data = trends_compute(days)
    mem_cache_set(cache_key, data)
    return JSONResponse(
        content=data,
        headers={
            "ETag": f'W/"tr-{data_revision}-{days}"',
            "Cache-Control": "private, max-age=15",
        },
    )


def api_uptime(
    *,
    days: int,
    data_revision: int,
    mem_cache_get: Callable[[str], Any | None],
    mem_cache_set: Callable[[str, Any], None],
    uptime_compute: Callable[[int], Any],
) -> JSONResponse:
    cache_key = f"uptime:{days}:{data_revision}"
    cached = mem_cache_get(cache_key)
    if cached is not None:
        return JSONResponse(
            content=cached,
            headers={
                "ETag": f'W/"up-{data_revision}-{days}"',
                "Cache-Control": "private, max-age=15",
            },
        )
    data = uptime_compute(days)
    mem_cache_set(cache_key, data)
    return JSONResponse(
        content=data,
        headers={
            "ETag": f'W/"up-{data_revision}-{days}"',
            "Cache-Control": "private, max-age=15",
        },
    )

