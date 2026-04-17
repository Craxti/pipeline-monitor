from __future__ import annotations

import asyncio


async def startup_proxy_from_config(*, cfg: dict, sync_cursor_proxy_from_config, logger) -> None:
    try:
        cp = await asyncio.to_thread(sync_cursor_proxy_from_config, cfg)
        logger.info("Embedded Cursor proxy: %s", cp)
    except Exception as exc:
        logger.warning("Embedded Cursor proxy startup failed: %s", exc)


async def shutdown_proxy(*, shutdown_fn, logger) -> None:
    try:
        await asyncio.to_thread(shutdown_fn)
    except Exception as exc:
        logger.warning("Embedded Cursor proxy shutdown: %s", exc)

