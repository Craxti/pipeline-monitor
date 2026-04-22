"""Collect status, logs, triggers, and auto-collect toggle."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from web.core.auth import require_shared_token

router = APIRouter(tags=["collect"])


@router.get("/api/collect/status", response_class=JSONResponse)
async def collect_status_route():
    """Return current collect status and auto-collect state."""
    from web.core import runtime as rt
    from web.services import collect_api, collect_endpoints

    return collect_endpoints.collect_status(
        collect_status_payload=collect_api.collect_status_payload,
        collect_state=rt.collect_state,
        auto_collect_enabled=True,
        auto_collect_enabled_at_iso=rt.auto_collect_rt.enabled_at_iso,
    )


@router.post(
    "/api/collect/auto",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def collect_auto_route(request: Request):
    """Enable/disable auto-collect mode."""
    from web.core.config import load_yaml_config
    from web.core import runtime as rt
    from web.services import collect_api, collect_endpoints
    from web.services import request_id
    from web.services import collect_tasks, collect_runtime_api
    from web.services import collect_loop as collect_loop_mod
    from web.services import sse_hub
    from web.services.collect_entrypoints import (
        run_collect_sync as _run_collect_sync,  # legacy wiring for now
    )

    enabled_ref = {"value": bool(rt.collect_state.get("auto_collect_enabled", False))}
    enabled_at_ref = {"value": rt.collect_state.get("auto_collect_enabled_at_iso")}

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

    out = await collect_endpoints.set_auto_collect(
        request_json=request.json,
        rid=request_id.rid(request),
        load_cfg=load_yaml_config,
        collect_state=rt.collect_state,
        parse_enabled=collect_api.parse_enabled,
        do_collect_task_factory=lambda cfg: asyncio.create_task(_do_collect(cfg, force_full=False)),
        auto_collect_enabled_ref=enabled_ref,
        auto_collect_enabled_at_iso_ref=enabled_at_ref,
    )
    rt.auto_collect_rt.enabled = bool(enabled_ref.get("value"))
    rt.auto_collect_rt.enabled_at_iso = enabled_at_ref.get("value")
    return out


@router.get("/api/collect/logs", response_class=JSONResponse)
async def collect_logs_route(limit: int = 400, offset: int = 0):
    """Return recent collect logs."""
    from web.core import runtime as rt

    return rt.collect_rt_state.collect_logs(limit=limit, offset=offset)


@router.get("/api/collect/slow", response_class=JSONResponse)
async def collect_slow_route(limit: int = 10, offset: int = 0):
    """Return slow-step timings for last collect (paged)."""
    from web.core import runtime as rt

    return rt.collect_rt_state.collect_slow(limit=limit, offset=offset)


@router.post(
    "/api/collect/stop",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def collect_stop_route():
    """Request cancellation of a running collect (cooperative; may finish current step)."""
    from web.core import runtime as rt
    from web.services import collect_endpoints

    return collect_endpoints.stop_collect_request(collect_state=rt.collect_state)


@router.post(
    "/api/collect",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def collect_trigger_route(request: Request):
    """Trigger a collect cycle (optionally full)."""
    from web.core.config import load_yaml_config
    from web.core import runtime as rt
    from web.services import collect_endpoints, collect_triggers
    from web.services import request_id
    from web.services import collect_tasks, collect_runtime_api
    from web.services import collect_loop as collect_loop_mod
    from web.services import sse_hub
    from web.services.collect_entrypoints import (
        run_collect_sync as _run_collect_sync,  # legacy wiring for now
    )

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

    rid = request_id.rid(request)
    return await collect_endpoints.trigger_collect(
        request_json=request.json,
        rid=rid,
        collect_state=rt.collect_state,
        load_cfg=load_yaml_config,
        parse_force_full=collect_triggers.parse_force_full,
        do_collect_task_factory=lambda cfg, force_full: asyncio.create_task(_do_collect(cfg, force_full=force_full)),
        started_payload=collect_triggers.started_payload,
    )
