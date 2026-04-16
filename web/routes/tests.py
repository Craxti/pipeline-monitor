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
    import web.app as m

    return await m.api_tests(
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
    import web.app as m

    return await m.api_top_failures(
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
    import web.app as m

    return await m.export_tests(
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
    import web.app as m

    return await m.export_failures(
        fmt=fmt,
        n=n,
        suite=suite,
        name=name,
        source=source,
        hours=hours,
        days=days,
    )
