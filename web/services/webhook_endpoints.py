from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

from fastapi import HTTPException, Request

logger = logging.getLogger(__name__)


async def webhook_build_complete(
    request: Request,
    *,
    load_snapshot: Callable[[], Any],
    save_snapshot: Callable[[Any], None],
    is_collecting: Callable[[], bool],
    load_cfg: Callable[[], dict],
    do_collect_task_factory: Callable[[dict], asyncio.Task],
    handle_build_complete: Callable[..., Any],
) -> Any:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON payload")

    logger.info("Webhook received: %s", payload)
    return handle_build_complete(
        payload,
        load_snapshot=load_snapshot,
        save_snapshot=save_snapshot,
        is_collecting=is_collecting,
        load_cfg=load_cfg,
        trigger_collect=lambda cfg: do_collect_task_factory(cfg),
    )

