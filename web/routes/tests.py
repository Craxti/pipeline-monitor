"""Tests API and related exports."""

from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, Response

router = APIRouter(tags=["tests"])


@router.get("/api/tests", response_class=JSONResponse)
async def api_tests_route(
    page: int = 1,
    per_page: int = 30,
    status: str = "",
    suite: str = "",
    name: str = "",
    hours: int = 0,
    source: str = "",
):
    """Return paginated tests list (with filtering)."""
    from models.models import normalize_test_status
    from web.core import runtime as rt
    from web.services import tests_analytics, tests_endpoints

    return await tests_endpoints.api_tests(
        load_snapshot_async=rt.load_snapshot_async,
        normalize_test_status=normalize_test_status,
        tests_breakdown_real_vs_synth=tests_analytics.tests_breakdown_real_vs_synth,
        filter_tests_by_source=tests_analytics.filter_tests_by_source,
        page=page,
        per_page=per_page,
        status=status,
        suite=suite,
        name=name,
        hours=hours,
        source=source,
    )


@router.get("/api/tests/top-failures", response_class=JSONResponse)
async def api_tests_top_failures_route(
    n: int = 50,
    page: int = 1,
    per_page: int = 20,
    suite: str = "",
    name: str = "",
    source: str = "",
    hours: int = 0,
    days: int = 0,
):
    """Return top failing tests aggregation."""
    from web.core import runtime as rt
    from web.services import tests_analytics, tests_endpoints

    return await tests_endpoints.api_top_failures(
        load_snapshot=rt.load_snapshot,
        filter_tests_by_lookback_hours=tests_analytics.filter_tests_by_lookback_hours,
        filter_tests_by_source=tests_analytics.filter_tests_by_source,
        aggregate_top_failing_tests=tests_analytics.aggregate_top_failing_tests,
        n=n,
        page=page,
        per_page=per_page,
        suite=suite,
        name=name,
        source=source,
        hours=hours,
        days=days,
    )


@router.get("/api/export/tests")
async def export_tests_route(
    fmt: str = "csv",
    status: str = "",
    suite: str = "",
    name: str = "",
    hours: int = 0,
    source: str = "",
):
    """Export tests as CSV or XLSX."""
    from web.core import runtime as rt
    from web.services import export_endpoints, exports

    return await export_endpoints.export_tests(
        export_tests_fn=exports.export_tests,
        load_snapshot=rt.load_snapshot,
        fmt=fmt,
        status=status,
        suite=suite,
        name=name,
        hours=hours,
        source=source,
    )


@router.get("/api/tests/jenkins-allure-details", response_class=JSONResponse)
async def api_tests_jenkins_allure_details_route(
    suite: str = Query("", description="Jenkins job name / path"),
    build_number: int = Query(..., ge=1),
    uid: str = Query(..., min_length=1, max_length=200),
    source_instance: str = Query("", description="Instance label from snapshot"),
):
    """Return Allure case description + image attachment list (fetched from Jenkins with server credentials)."""
    from web.core.config import load_yaml_config
    from web.services import jenkins_allure_details as jad

    cfg = load_yaml_config()
    payload = jad.fetch_allure_details_payload(
        cfg,
        source_instance=source_instance or None,
        suite=suite,
        build_number=build_number,
        uid=uid,
    )
    if not payload:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return JSONResponse(payload)


@router.get("/api/tests/jenkins-allure-attachment")
async def api_tests_jenkins_allure_attachment_route(
    suite: str = Query(""),
    build_number: int = Query(..., ge=1),
    src: str = Query(..., min_length=1, max_length=512, description="Path under allure/data"),
    source_instance: str = Query(""),
):
    """Proxy Allure attachment bytes from Jenkins (images etc.)."""
    from web.core.config import load_yaml_config
    from web.services import jenkins_allure_details as jad

    cfg = load_yaml_config()
    out = jad.fetch_allure_attachment_bytes(
        cfg,
        source_instance=source_instance or None,
        suite=suite,
        build_number=build_number,
        src=src,
    )
    if not out:
        return Response(status_code=404)
    data, ct = out
    return Response(content=data, media_type=ct or "application/octet-stream")


@router.get("/api/export/failures")
async def export_failures_route(
    fmt: str = "csv",
    n: int = 500,
    suite: str = "",
    name: str = "",
    source: str = "",
    hours: int = 0,
    days: int = 0,
):
    """Export top failures as CSV or XLSX."""
    from web.core import runtime as rt
    from web.services import export_endpoints, exports

    return await export_endpoints.export_failures(
        export_failures_fn=exports.export_failures,
        load_snapshot=rt.load_snapshot,
        fmt=fmt,
        n=n,
        suite=suite,
        name=name,
        source=source,
        hours=hours,
        days=days,
    )
