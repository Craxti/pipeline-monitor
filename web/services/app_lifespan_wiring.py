"""FastAPI lifespan wiring helpers."""

from __future__ import annotations

import asyncio
import logging
from typing import Callable

from web.core import runtime as rt
from web.services import (
    app_boot_log,
    collect_task_lifecycle,
    cursor_proxy_lifecycle,
    lifespan_factory,
    proxy_routes,
    service_logs_bridge,
    sqlite_boot,
)


def make_app_lifespan(
    *,
    load_cfg: Callable[[], dict],
    sqlite_available: bool,
    init_db: Callable[..., object] | None,
    app_build: str,
    config_path: Callable[[], str],
    sync_cursor_proxy_from_config: Callable[[dict], dict],
    shutdown_embedded_cursor_proxy: Callable[[], None],
    collect_state: object,
    collect_loop: Callable[..., object],
    logger: logging.Logger,
) -> Callable:
    """
    Provide FastAPI lifespan context manager wired with project dependencies.

    Keeping this out of `web.app` makes app.py closer to a pure composer module.
    """

    collect_task: asyncio.Task | None = None
    service_log_handler: logging.Handler | None = None

    def _set_main_loop(loop: asyncio.AbstractEventLoop) -> None:
        rt.main_loop = loop

    def _init_sqlite(cfg: dict) -> None:
        sqlite_boot.init_sqlite_if_available(
            cfg=cfg,
            sqlite_available=sqlite_available,
            init_db=init_db,
            logger=logger,
        )

    def _start_collect_task(cfg: dict, w_cfg: dict) -> asyncio.Task | None:
        nonlocal collect_task
        collect_task = collect_task_lifecycle.start_collect_loop_task(
            cfg=cfg,
            w_cfg=w_cfg,
            collect_state=collect_state,
            collect_loop=collect_loop,
            create_task=asyncio.create_task,
            logger=logger,
        )
        return collect_task

    def _log_boot(proxy_paths: list[str]) -> None:
        nonlocal service_log_handler
        if service_log_handler is None:
            service_log_handler = service_logs_bridge.install_runtime_collect_log_bridge(
                push_log=rt.collect_rt_state.push_log
            )
        app_boot_log.log_boot(
            app_build=app_build,
            config_path=config_path(),
            proxy_paths=proxy_paths,
            logger=logger,
        )

    async def _startup_proxy(cfg: dict) -> None:
        await cursor_proxy_lifecycle.startup_proxy_from_config(
            cfg=cfg,
            sync_cursor_proxy_from_config=sync_cursor_proxy_from_config,
            logger=logger,
        )

    async def _shutdown_proxy() -> None:
        nonlocal service_log_handler
        service_logs_bridge.uninstall_runtime_collect_log_bridge(service_log_handler)
        service_log_handler = None
        await cursor_proxy_lifecycle.shutdown_proxy(
            shutdown_fn=shutdown_embedded_cursor_proxy,
            logger=logger,
        )

    return lifespan_factory.make_lifespan(
        load_cfg=load_cfg,
        set_main_loop=_set_main_loop,
        init_sqlite=_init_sqlite,
        start_collect_task=_start_collect_task,
        proxy_paths=proxy_routes.proxy_paths_for_app,
        log_boot=_log_boot,
        startup_proxy=_startup_proxy,
        shutdown_proxy=_shutdown_proxy,
        stop_collect_task=collect_task_lifecycle.cancel_task,
    )
