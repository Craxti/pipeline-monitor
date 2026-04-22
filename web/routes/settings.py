"""Settings HTML page and JSON API."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Request
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
    "/api/settings",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def api_settings_save_route(request: Request):
    """Save settings and restart collect loop if needed."""
    # Import lazily to avoid circular imports on startup.
    from web.services import cursor_proxy
    from web.services import collect_loop as collect_loop_mod
    from web.services import collect_tasks, collect_runtime_api
    from web.services import sse_hub
    from web.services.collect_entrypoints import run_collect_sync as _run_collect_sync

    task_ref = {"task": None}

    async def _do_collect(cfg: dict, force_full: bool = False) -> None:
        return await collect_tasks.do_collect(
            cfg,
            force_full=force_full,
            collect_loop_mod=collect_loop_mod,
            collect_state=rt.collect_state,
            collect_logs=rt.collect_logs,
            collect_slow=rt.collect_slow,
            push_collect_log=collect_runtime_api.push_collect_log,
            run_collect_sync=lambda c, *, force_full=False: _run_collect_sync(
                c,
                force_full=force_full,
            ),
            sse_broadcast_async=lambda payload: collect_runtime_api.sse_broadcast_async(
                sse_hub,
                payload,
            ),
            data_revision=rt.revision_rt.revision,
        )

    out = await settings_save_endpoint.api_save_settings(
        request,
        settings_api_save=settings_api.save_settings_and_restart_collect,
        load_cfg=load_yaml_config,
        collect_state=rt.collect_state,
        collect_loop_task_ref=task_ref,
        create_collect_loop_task=lambda cfg: asyncio.create_task(
            collect_loop_mod.collect_loop(
                cfg,
                auto_collect_enabled_getter=lambda: bool(rt.auto_collect_rt.enabled),
                interval_seconds_getter=lambda: int(rt.collect_state.get("interval_seconds") or 300),
                do_collect_fn=lambda c: _do_collect(c, force_full=False),
            )
        ),
        create_do_collect_task=lambda cfg: asyncio.create_task(_do_collect(cfg, force_full=False)),
        sync_cursor_proxy=lambda cfg: asyncio.to_thread(
            cursor_proxy.sync_cursor_proxy_from_config,
            cfg,
        ),
    )
    return out


@router.get("/settings", response_class=HTMLResponse)
async def settings_page_route(request: Request):
    """Render settings page."""
    templates = create_templates()
    return await pages.settings_page(
        request,
        templates=templates,
        ui_language=ui_lang.ui_lang_from_config(load_yaml_config),
    )
