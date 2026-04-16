"""Service health listing API."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(tags=["services"])


@router.get("/api/services", response_class=JSONResponse)
async def api_services_route(page: int = 1, per_page: int = 50, status: str = ""):
    import web.app as m

    return await m.api_services(page=page, per_page=per_page, status=status)
