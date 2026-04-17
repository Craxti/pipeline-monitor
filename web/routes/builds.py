"""Builds & instances API (``/api/builds*``, ``/api/instances*``, export builds).

Avoid importing ``web.app`` from route handlers to prevent circular imports and
keep the app composition module thin.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

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
    from models.models import normalize_build_status
    from web.core.config import load_yaml_config
    from web.core import runtime as rt
    from web.services.build_filters import inst_label_for_build_with_cfg, is_snapshot_build_enabled
    from web.services import build_analytics
    from web.services import builds_endpoints

    return await builds_endpoints.api_builds(
        load_snapshot_async=rt.load_snapshot_async,
        load_yaml_config=load_yaml_config,
        is_snapshot_build_enabled=is_snapshot_build_enabled,
        inst_label_for_build_with_cfg=inst_label_for_build_with_cfg,
        normalize_build_status=normalize_build_status,
        job_build_analytics=build_analytics.job_build_analytics,
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
    from web.core.config import load_yaml_config
    from web.services.build_filters import config_instance_label
    from web.services import instances_endpoints

    return instances_endpoints.api_instances(
        load_yaml_config=load_yaml_config,
        config_instance_label=config_instance_label,
    )


@router.get("/api/builds/history", response_class=JSONResponse)
async def api_builds_history_route(
    page: int = 1,
    per_page: int = 50,
    job: str = "",
    source: str = "",
    status: str = "",
    days: int = 30,
):
    from web.services import builds_history_endpoints
    from web.services import sqlite_imports as _db_opt

    return builds_history_endpoints.api_builds_history(
        sqlite_available=bool(_db_opt.SQLITE_AVAILABLE),
        db_query_builds_history=_db_opt.query_builds_history,
        page=page,
        per_page=per_page,
        job=job,
        source=source,
        status=status,
        days=days,
    )


@router.get("/api/instances/health", response_class=JSONResponse)
async def api_instances_health_route():
    from web.core import runtime as rt
    from web.services import instances_health_endpoint

    return instances_health_endpoint.instances_health_payload(
        collect_state=rt.collect_state,
        instances=rt.get_instance_health(),
    )


@router.get("/api/export/builds")
async def export_builds_route(
    fmt: str = "csv",
    source: str = "",
    status: str = "",
    job: str = "",
    hours: int = 0,
):
    from web.core import runtime as rt
    from web.services import export_endpoints
    from web.services import exports

    return await export_endpoints.export_builds(
        export_builds_fn=exports.export_builds,
        load_snapshot=rt.load_snapshot,
        fmt=fmt,
        source=source,
        status=status,
        job=job,
        hours=hours,
    )
