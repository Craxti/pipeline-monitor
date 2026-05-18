"""Settings HTML page and JSON API."""

from __future__ import annotations

import asyncio
import json
from collections import Counter
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse

from web.core.auth import require_shared_token
from web.core.config import load_yaml_config
from web.core import runtime as rt
from web.core.templates import create_templates
from web.services import (
    pages,
    settings_connection_test,
    settings_api,
    settings_public,
    settings_save_endpoint,
    ui_lang,
)

router = APIRouter(tags=["settings"])


@router.get(
    "/api/settings",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def api_settings_route():
    """Return full settings (requires shared token)."""
    return settings_api.get_settings(load_yaml_config())


@router.get(
    "/api/settings/reveal",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def api_settings_reveal_route():
    """Return unmasked settings for UI reveal (requires shared token)."""
    return load_yaml_config()


@router.get("/api/settings/public", response_class=JSONResponse)
async def api_settings_public_route():
    """Return public settings for UI."""
    return settings_api.get_settings_public(
        settings_public.public_settings_payload,
        load_yaml_config(),
    )


@router.post(
    "/api/settings/test-connection",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def api_settings_test_connection_route(request: Request):
    """Test Jenkins/GitLab credentials without saving settings."""
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    result = settings_connection_test.check_connection(payload if isinstance(payload, dict) else {})
    return result


@router.post(
    "/api/har/analyze",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def api_har_analyze_route(file: UploadFile = File(...)):
    """Analyze uploaded HAR and return lightweight diagnostics."""

    def _safe_int(value: object, *, default: int = 0) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def _safe_float(value: object, *, default: float = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    name = (file.filename or "").lower()
    if name and not name.endswith(".har") and not name.endswith(".json"):
        return JSONResponse({"detail": "Upload a .har or .json file."}, status_code=400)
    try:
        raw = await file.read()
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        return JSONResponse({"detail": "Could not parse HAR JSON."}, status_code=400)
    log = payload.get("log") if isinstance(payload, dict) else None
    entries = log.get("entries") if isinstance(log, dict) else None
    if not isinstance(entries, list):
        return JSONResponse({"detail": "Invalid HAR: missing log.entries list."}, status_code=400)

    total = len(entries)
    failed = []
    slow = []
    status_counter = Counter()
    host_counter = Counter()
    total_time = 0.0
    timed_count = 0
    warnings: list[str] = []
    skipped_entries = 0
    for idx, item in enumerate(entries):
        if not isinstance(item, dict):
            skipped_entries += 1
            warnings.append(f"entry[{idx}] skipped: expected object")
            continue
        request = item.get("request") if isinstance(item.get("request"), dict) else {}
        response = item.get("response") if isinstance(item.get("response"), dict) else {}
        timings = item.get("timings") if isinstance(item.get("timings"), dict) else {}
        url = str(request.get("url") or "")
        method = str(request.get("method") or "GET")
        raw_status = response.get("status")
        status = _safe_int(raw_status, default=0)
        if raw_status not in (None, "") and status == 0:
            warnings.append(f"entry[{idx}] invalid response.status={raw_status!r}; using 0")
        raw_time = item.get("time")
        time_ms = _safe_float(raw_time, default=0.0)
        if raw_time not in (None, "") and time_ms == 0.0:
            warnings.append(f"entry[{idx}] invalid time={raw_time!r}; using 0")
        if time_ms > 0:
            total_time += time_ms
            timed_count += 1
        host = urlparse(url).netloc
        if host:
            host_counter[host] += 1
        if status > 0:
            status_counter[str(status)] += 1

        net_error = str(item.get("_error") or item.get("_errorText") or "").strip()
        if status >= 400 or net_error:
            failed.append(
                {
                    "method": method,
                    "url": url,
                    "status": status or None,
                    "time_ms": round(time_ms, 2) if time_ms else None,
                    "error": net_error or None,
                }
            )
        if time_ms >= 2000:
            raw_wait = timings.get("wait")
            wait_ms = _safe_float(raw_wait, default=0.0)
            if raw_wait not in (None, "") and wait_ms == 0.0:
                warnings.append(f"entry[{idx}] invalid timings.wait={raw_wait!r}; using 0")
            slow.append(
                {
                    "method": method,
                    "url": url,
                    "status": status or None,
                    "time_ms": round(time_ms, 2),
                    "wait_ms": round(wait_ms, 2) if wait_ms else None,
                }
            )

    failed.sort(key=lambda x: (x.get("status") is None, -(x.get("status") or 0)))
    slow.sort(key=lambda x: x.get("time_ms") or 0, reverse=True)
    top_statuses = [{"status": k, "count": v} for k, v in status_counter.most_common(10)]
    top_hosts = [{"host": k, "count": v} for k, v in host_counter.most_common(10)]

    return {
        "file_name": file.filename,
        "summary": {
            "total_requests": total,
            "failed_requests": len(failed),
            "slow_requests": len(slow),
            "avg_time_ms": round((total_time / timed_count), 2) if timed_count else 0,
        },
        "top_statuses": top_statuses,
        "top_hosts": top_hosts,
        "failed_requests": failed[:200],
        "slow_requests": slow[:200],
        "warnings": warnings[:200],
        "skipped_entries": skipped_entries,
    }


@router.post(
    "/api/settings",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def api_settings_save_route(request: Request):
    """Save settings and restart collect loop if needed."""
    # Import lazily to avoid circular imports on startup.
    from web.services import cursor_proxy
    from web.services import collect_runner_factory

    task_ref = {"task": None}

    out = await settings_save_endpoint.api_save_settings(
        request,
        settings_api_save=settings_api.save_settings_and_restart_collect,
        load_cfg=load_yaml_config,
        collect_state=rt.collect_state,
        collect_loop_task_ref=task_ref,
        create_collect_loop_task=collect_runner_factory.create_collect_loop_task,
        create_do_collect_task=collect_runner_factory.create_do_collect_task_factory(force_full=False),
        sync_cursor_proxy=lambda cfg: asyncio.to_thread(
            cursor_proxy.sync_cursor_proxy_from_config,
            cfg,
        ),
    )
    return out


@router.post(
    "/api/settings/reset-data",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def api_settings_reset_data_route():
    """Delete collected runtime data while keeping saved credentials/settings."""
    try:
        from web import db as db_store

        if not db_store.ensure_database_initialized():
            return JSONResponse({"ok": False, "detail": "Database is not initialized."}, status_code=503)
        cleared = db_store.clear_runtime_data()
        return {
            "ok": True,
            "message": "Collected data has been reset. Credentials and settings were kept.",
            "cleared": cleared,
        }
    except Exception as exc:
        return JSONResponse({"ok": False, "detail": str(exc)}, status_code=500)


@router.get("/settings", response_class=HTMLResponse)
async def settings_page_route(request: Request):
    """Render settings page."""
    templates = create_templates()
    return await pages.settings_page(
        request,
        templates=templates,
        ui_language=ui_lang.ui_lang_from_config(load_yaml_config),
    )
