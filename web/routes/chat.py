"""AI chat streaming and diagnostics."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from web.core.auth import require_shared_token

router = APIRouter(tags=["chat"])


@router.post(
    "/api/chat",
    dependencies=[Depends(require_shared_token)],
)
async def api_chat_route(request: Request):
    import web.app as m

    return await m.api_chat(request)


@router.get(
    "/api/chat/status",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def api_chat_status_route():
    import web.app as m

    return await m.api_chat_status()


@router.get(
    "/api/chat/proxy-check",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def api_chat_proxy_check_route():
    import web.app as m

    return await m.api_chat_proxy_check()


@router.get(
    "/api/proxy-check",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def api_proxy_check_alias_route():
    import web.app as m

    return await m.api_chat_proxy_check()
