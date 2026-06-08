"""HTML page handlers and common security headers."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from fastapi import Request


def apply_no_cache_headers(resp) -> None:
    """Apply no-cache headers to an HTTP response."""
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    resp.headers["Pragma"] = "no-cache"


def apply_csp_headers(resp) -> None:
    """Apply a conservative Content-Security-Policy."""
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "base-uri 'self'; "
        "object-src 'none'; "
        "frame-ancestors 'self'; "
        "img-src 'self' data:; "
        "style-src 'self' 'unsafe-inline'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://esm.sh; "
        "connect-src 'self'; "
        "font-src 'self' data:; "
    )


async def settings_page(
    request: Request,
    *,
    templates,
    ui_language: str,
):
    """Render the settings page."""
    resp = templates.TemplateResponse(
        request,
        "settings.html",
        {"ui_language": ui_language},
    )
    apply_no_cache_headers(resp)
    apply_csp_headers(resp)
    return resp


async def index_page(
    request: Request,
    *,
    templates,
    load_snapshot_async: Callable[[], Awaitable[Any]],
    cfg: dict,
    ui_language: str,
):
    """Render the main dashboard page."""
    snap = await load_snapshot_async()
    ctx: dict = {
        "snap": snap,
        "ui_language": ui_language,
    }
    if snap:
        builds = list(getattr(snap, "builds", None) or [])
        tests = list(getattr(snap, "tests", None) or [])
        services = list(getattr(snap, "services", None) or [])
        ctx["builds_ok"] = sum(1 for b in builds if getattr(b, "status_normalized", None) == "success")
        ctx["builds_fail"] = sum(1 for b in builds if getattr(b, "status_normalized", None) in ("failure", "unstable"))
        ctx["tests_total"] = len(tests)
        ctx["tests_fail"] = sum(1 for t in tests if getattr(t, "status_normalized", None) in ("failed", "error"))
        ctx["svcs_total"] = len(services)
        ctx["svc_down"] = sum(1 for s in services if getattr(s, "status_normalized", None) == "down")
        n_pass = max(0, ctx["tests_total"] - ctx["tests_fail"])
        ctx["tests_pass_rate"] = round((n_pass / ctx["tests_total"]) * 1000) / 10 if ctx["tests_total"] else None

    resp = templates.TemplateResponse(request, "index.html", ctx)
    apply_no_cache_headers(resp)
    apply_csp_headers(resp)
    return resp
