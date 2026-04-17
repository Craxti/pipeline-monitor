"""Settings HTML page and JSON API."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, JSONResponse

from web.core.auth import require_shared_token

router = APIRouter(tags=["settings"])


@router.get(
    "/api/settings",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def api_settings_route():
    import web.app as m

    return await m.api_get_settings()


@router.get("/api/settings/public", response_class=JSONResponse)
async def api_settings_public_route():
    import web.app as m

    return await m.api_get_settings_public()


@router.post(
    "/api/settings",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def api_settings_save_route(request: Request):
    import web.app as m

    return await m.api_save_settings(request)


@router.get("/settings", response_class=HTMLResponse)
async def settings_page_route(request: Request):
    import web.app as m

    return await m.settings_page(request)
