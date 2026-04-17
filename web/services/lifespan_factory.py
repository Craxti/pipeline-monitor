from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from collections.abc import Awaitable, Callable


def make_lifespan(
    *,
    load_cfg: Callable[[], dict],
    set_main_loop: Callable[[asyncio.AbstractEventLoop], None],
    init_sqlite: Callable[[dict], None],
    start_collect_task: Callable[[dict, dict], asyncio.Task | None],
    proxy_paths: Callable[[object], list[str]],
    log_boot: Callable[[list[str]], None],
    startup_proxy: Callable[[dict], Awaitable[None]],
    shutdown_proxy: Callable[[], Awaitable[None]],
    stop_collect_task: Callable[[asyncio.Task | None], Awaitable[None]],
) -> Callable[[object], Awaitable[None]]:
    @asynccontextmanager
    async def _lifespan(app):
        cfg = load_cfg()
        set_main_loop(asyncio.get_running_loop())
        w_cfg = cfg.get("web", {})

        init_sqlite(cfg)
        collect_task = start_collect_task(cfg, w_cfg)

        paths = proxy_paths(app)
        log_boot(paths)
        await startup_proxy(cfg)

        try:
            yield
        finally:
            await shutdown_proxy()
            await stop_collect_task(collect_task)

    return _lifespan

