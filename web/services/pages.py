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
        "settings.html",
        {"request": request, "ui_language": ui_language},
    )
    apply_no_cache_headers(resp)
    apply_csp_headers(resp)
    return resp


async def index_page(
    request: Request,
    *,
    templates,
    load_snapshot_async: Callable[[], Awaitable[Any]],
    load_yaml_config: Callable[[], dict],
    ui_language: str,
):
    """Render the main dashboard page."""
    snap = await load_snapshot_async()
    _ = load_yaml_config()  # kept for behavior parity (side-effects / validation)
    ctx: dict = {
        "request": request,
        "snap": snap,
        "ui_language": ui_language,
    }
    if snap:
        ctx["builds_ok"] = sum(1 for b in snap.builds if b.status_normalized == "success")
        ctx["builds_fail"] = sum(1 for b in snap.builds if b.status_normalized == "failure")
        ctx["tests_fail"] = sum(1 for t in snap.tests if t.status_normalized in ("failed", "error"))
        ctx["svc_down"] = sum(1 for s in snap.services if s.status_normalized == "down")

    resp = templates.TemplateResponse("index.html", ctx)
    apply_no_cache_headers(resp)
    apply_csp_headers(resp)
    return resp
