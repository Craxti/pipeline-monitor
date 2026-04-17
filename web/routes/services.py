"""Service health listing API."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(tags=["services"])


@router.get("/api/services", response_class=JSONResponse)
async def api_services_route(page: int = 1, per_page: int = 50, status: str = ""):
    """Return paginated services list."""
    from models.models import normalize_service_status
    from web.core import runtime as rt
    from web.services import services_endpoints

    return await services_endpoints.api_services(
        load_snapshot_async=rt.load_snapshot_async,
        normalize_service_status=normalize_service_status,
        page=page,
        per_page=per_page,
        status=status,
    )
