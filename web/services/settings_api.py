"""Settings API helpers (mask, public payload, save + restart collect)."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from fastapi import HTTPException

from web.core.config import save_app_config
from web.core.settings_secrets import (
    mask_settings_for_response,
    merge_settings_secrets,
)


def get_settings(masked_cfg: dict) -> dict:
    """Return settings masked for UI response."""
    return mask_settings_for_response(masked_cfg)


def get_settings_public(payload_builder: Callable[[dict], dict], cfg: dict) -> dict:
    """Return public (non-secret) settings payload."""
    return payload_builder(cfg)


async def save_settings_and_restart_collect(
    *,
    request_json: Callable[[], Awaitable[Any]],
    load_cfg: Callable[[], dict],
    cancel_collect_task: Callable[[], Awaitable[None]],
    set_collect_state_after_save: Callable[[dict], None],
    restart_collect_after_save: Callable[[dict], None],
    sync_cursor_proxy: Callable[[dict], Awaitable[dict]],
) -> dict:
    """Persist new config and restart collection loop using updated settings."""
    try:
        new_cfg = await request_json()
    except Exception:
        raise HTTPException(400, "Invalid JSON payload") from None

    saved = load_cfg()
    merged = merge_settings_secrets(new_cfg, saved)
    save_app_config(merged)

    await cancel_collect_task()
    set_collect_state_after_save(merged)
    restart_collect_after_save(merged)

    msg = "Settings saved. Collection restarted with the new configuration."
    cursor_proxy: dict = {}
    try:
        cursor_proxy = await sync_cursor_proxy(merged) or {}
        if cursor_proxy.get("message"):
            msg += " " + cursor_proxy["message"]
    except Exception as exc:
        cursor_proxy = {"managed": False, "ok": False, "message": str(exc)}

    return {"ok": True, "message": msg, "cursor_proxy": cursor_proxy}
