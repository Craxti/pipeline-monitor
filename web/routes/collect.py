"""Collect status, logs, triggers, and auto-collect toggle."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from web.app import require_shared_token

router = APIRouter(tags=["collect"])


@router.get("/api/collect/status", response_class=JSONResponse)
async def collect_status_route():
    import web.app as m

    return await m.collect_status()


@router.post(
    "/api/collect/auto",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def collect_auto_route(request: Request):
    import web.app as m

    return await m.set_auto_collect(request)


@router.get("/api/collect/logs", response_class=JSONResponse)
async def collect_logs_route(limit: int = 400, offset: int = 0):
    import web.app as m

    return await m.collect_logs(limit=limit, offset=offset)


@router.get("/api/collect/slow", response_class=JSONResponse)
async def collect_slow_route(limit: int = 10):
    import web.app as m

    return await m.collect_slow(limit=limit)


@router.post(
    "/api/collect",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def collect_trigger_route(request: Request):
    import web.app as m

    return await m.trigger_collect(request)
