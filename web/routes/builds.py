"""Builds & instances API (``/api/builds*``, ``/api/instances*``, export builds)."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse, Response

router = APIRouter(tags=["builds"])


@router.get("/api/builds", response_class=JSONResponse)
async def api_builds_route(
    page: int = 1,
    per_page: int = 20,
    source: str = "",
    instance: str = "",
    status: str = "",
    job: str = "",
    hours: int = 0,
):
    import web.app as m

    return await m.api_builds(
        page=page,
        per_page=per_page,
        source=source,
        instance=instance,
        status=status,
        job=job,
        hours=hours,
    )


@router.get("/api/instances", response_class=JSONResponse)
async def api_instances_route():
    import web.app as m

    return await m.api_instances()


@router.get("/api/builds/history", response_class=JSONResponse)
async def api_builds_history_route(
    page: int = 1,
    per_page: int = 50,
    job: str = "",
    source: str = "",
    status: str = "",
    days: int = 30,
):
    import web.app as m

    return await m.api_builds_history(
        page=page,
        per_page=per_page,
        job=job,
        source=source,
        status=status,
        days=days,
    )


@router.get("/api/instances/health", response_class=JSONResponse)
async def api_instances_health_route():
    import web.app as m

    return await m.api_instances_health()


@router.get("/api/export/builds")
async def export_builds_route(
    fmt: str = "csv",
    source: str = "",
    status: str = "",
    job: str = "",
    hours: int = 0,
):
    import web.app as m

    return await m.export_builds(
        fmt=fmt,
        source=source,
        status=status,
        job=job,
        hours=hours,
    )
