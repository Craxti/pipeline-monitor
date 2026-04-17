"""FastAPI endpoint for saving settings + restarting collect."""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable

from fastapi import Request

from web.services.collect_task_lifecycle import (
    clear_auto_collect_runtime,
    prime_auto_collect_for_web_config,
)


async def api_save_settings(
    request: Request,
    *,
    settings_api_save: Callable[..., Awaitable[Any]],
    load_cfg: Callable[[], dict],
    config_yaml_path: Callable[[], Any],
    collect_state: dict,
    collect_loop_task_ref: dict,
    create_collect_loop_task: Callable[[dict], asyncio.Task],
    create_do_collect_task: Callable[[dict], asyncio.Task],
    sync_cursor_proxy: Callable[[dict], Awaitable[Any]],
) -> Any:
    """Save settings and restart collection tasks if needed."""

    async def _cancel_collect_task() -> None:
        t = collect_loop_task_ref.get("task")
        if t and not t.done():
            t.cancel()
            try:
                await t
            except asyncio.CancelledError:
                pass
            collect_loop_task_ref["task"] = None

    def _set_collect_state_after_save(merged: dict) -> None:
        collect_state["is_collecting"] = False
        collect_state["last_error"] = None
        w_cfg = merged.get("web", {})
        collect_state["interval_seconds"] = int(w_cfg.get("collect_interval_seconds", 300))

    def _restart_collect_after_save(merged: dict) -> None:
        import logging

        _log = logging.getLogger(__name__)
        w_cfg = merged.get("web", {})
        if w_cfg.get("auto_collect", True):
            prime_auto_collect_for_web_config(w_cfg, logger=_log)
            collect_loop_task_ref["task"] = create_collect_loop_task(merged)
        else:
            clear_auto_collect_runtime(logger=_log)
            create_do_collect_task(merged)

    return await settings_api_save(
        request_json=request.json,
        load_cfg=load_cfg,
        config_yaml_path=config_yaml_path,
        cancel_collect_task=_cancel_collect_task,
        set_collect_state_after_save=_set_collect_state_after_save,
        restart_collect_after_save=_restart_collect_after_save,
        sync_cursor_proxy=sync_cursor_proxy,
    )
