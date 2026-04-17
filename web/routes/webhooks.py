"""Webhook endpoints."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Request

from web.core.auth import require_shared_token
from web.core.config import load_yaml_config
from web.core import runtime as rt
from web.services import collect_loop as collect_loop_mod
from web.services import collect_tasks
from web.services import request_id
from web.services import webhook_endpoints, webhooks

router = APIRouter(tags=["webhook"])


@router.post("/webhook/build-complete", dependencies=[Depends(require_shared_token)])
async def webhook_build_complete(request: Request):
    # Import lazily to avoid circular imports during app startup.
    from web.services.collect_entrypoints import save_snapshot, run_collect_sync as _run_collect_sync
    from web.services import collect_runtime_api
    from web.services import sse_hub

    async def _do_collect(cfg: dict, force_full: bool = False) -> None:
        return await collect_tasks.do_collect(
            cfg,
            force_full=force_full,
            collect_loop_mod=collect_loop_mod,
            collect_state=rt.collect_state,
            collect_logs=rt.collect_logs,
            collect_slow=rt.collect_slow,
            push_collect_log=collect_runtime_api.push_collect_log,
            run_collect_sync=lambda c, *, force_full=False: _run_collect_sync(c, force_full=force_full),
            sse_broadcast_async=lambda payload: collect_runtime_api.sse_broadcast_async(sse_hub, payload),
            data_revision=rt.revision_rt.revision,
        )

    return await webhook_endpoints.webhook_build_complete(
        request,
        load_snapshot=rt.load_snapshot,
        save_snapshot=save_snapshot,
        is_collecting=lambda: bool(rt.collect_state.get("is_collecting")),
        load_cfg=load_yaml_config,
        do_collect_task_factory=lambda cfg: asyncio.create_task(_do_collect(cfg, force_full=False)),
        handle_build_complete=webhooks.handle_build_complete,
    )

