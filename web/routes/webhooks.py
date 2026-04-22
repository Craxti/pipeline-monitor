"""Webhook endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from web.core.auth import require_shared_token
from web.core.config import load_yaml_config
from web.core import runtime as rt
from web.services import webhook_endpoints, webhooks

router = APIRouter(tags=["webhook"])


@router.post("/webhook/build-complete", dependencies=[Depends(require_shared_token)])
async def webhook_build_complete(request: Request):
    """Handle build-complete webhook and trigger collection."""
    # Import lazily to avoid circular imports during app startup.
    from web.services.collect_entrypoints import save_snapshot
    from web.services import collect_runner_factory

    return await webhook_endpoints.webhook_build_complete(
        request,
        load_snapshot=rt.load_snapshot,
        save_snapshot=save_snapshot,
        is_collecting=lambda: bool(rt.collect_state.get("is_collecting")),
        load_cfg=load_yaml_config,
        do_collect_task_factory=collect_runner_factory.create_do_collect_task_factory(force_full=False),
        handle_build_complete=webhooks.handle_build_complete,
    )
