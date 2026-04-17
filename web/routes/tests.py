"""Tests API and related exports."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

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
