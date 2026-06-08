"""Service-analysis incident API routes."""

from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from web.services import service_incidents_endpoints

router = APIRouter(tags=["service-incidents"])


@router.get("/api/service-incidents", response_class=JSONResponse)
async def api_service_incidents_list(status: str = Query(""), limit: int = Query(100)):
    return service_incidents_endpoints.api_list_incidents(status=status, limit=limit)


@router.get("/api/service-incidents/{incident_id:int}", response_class=JSONResponse)
async def api_service_incidents_get(incident_id: int):
    return service_incidents_endpoints.api_get_incident(incident_id)
