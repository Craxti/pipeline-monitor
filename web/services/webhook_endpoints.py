"""FastAPI endpoints for handling incoming webhooks."""

from __future__ import annotations

import logging
from typing import Any, Callable

from fastapi import HTTPException, Request

logger = logging.getLogger(__name__)


async def webhook_build_complete(
    request: Request,
    *,
    load_snapshot: Callable[[], Any],
    save_snapshot: Callable[[Any], None],
    is_collecting: Callable[[], bool],
    load_cfg: Callable[[], dict],
    do_collect_task_factory: Callable[[dict], Any],
    handle_build_complete: Callable[..., Any],
) -> Any:
    """Handle build-complete webhook and update snapshot."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON payload") from None

    logger.info("Webhook received: %s", payload)
    return handle_build_complete(
        payload,
        load_snapshot=load_snapshot,
        save_snapshot=save_snapshot,
        is_collecting=is_collecting,
        load_cfg=load_cfg,
        trigger_collect=do_collect_task_factory,
    )
