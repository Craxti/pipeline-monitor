"""System monitoring API."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from web.services import system_endpoints

router = APIRouter(tags=["system"])


@router.get("/api/system/metrics", response_class=JSONResponse)
async def api_system_metrics_route():
    """Return host runtime metrics for dashboard System tab."""
    return system_endpoints.system_metrics_payload()
