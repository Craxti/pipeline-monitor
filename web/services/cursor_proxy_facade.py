from __future__ import annotations


def cursor_proxy_autostart_enabled(cursor_proxy_mod, cfg: dict) -> bool:
    return cursor_proxy_mod.cursor_proxy_autostart_enabled(cfg)


def cursor_proxy_should_run(cursor_proxy_mod, cfg: dict) -> bool:
    return cursor_proxy_mod.cursor_proxy_should_run(cfg)


def resolve_cursor_agent_cached(cursor_proxy_mod, cfg: dict) -> str | None:
    return cursor_proxy_mod.resolve_cursor_agent_cached(cfg)


def shutdown_embedded_cursor_proxy(cursor_proxy_mod) -> None:
    return cursor_proxy_mod.shutdown_embedded_cursor_proxy()


def sync_cursor_proxy_from_config(cursor_proxy_mod, cfg: dict) -> dict:
    return cursor_proxy_mod.sync_cursor_proxy_from_config(cfg)


def cursor_proxy_running(cursor_proxy_mod) -> bool:
    return cursor_proxy_mod.cursor_proxy_running()

