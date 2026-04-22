"""
FastAPI application composer.

This module contains the actual wiring for the FastAPI `app` object, keeping
`web.app` as a thin compatibility wrapper for external imports.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, Request

from web.core.config import (
    config_yaml_path as _config_yaml_path,
    load_yaml_config as _load_yaml_config,
)
from web.core import runtime as _rt
from web.services import app_constants as _app_constants
from web.services import app_lifespan_wiring as _app_lifespan_wiring
from web.services import openapi_safe as _openapi_safe
from web.services import request_id as _request_id
from web.services import router_include as _router_include
from web.services import sqlite_imports as _db_opt
from web.services import static_mount as _static_mount
from web.services import templates_boot as _templates_boot

from web.routes.actions import router as _actions_router
from web.routes.builds import router as _builds_router
from web.routes.chat import router as _chat_router
from web.routes.collect import router as _collect_router
from web.routes.dashboard import router as _dashboard_router
from web.routes.incident import router as _incident_router
from web.routes.logs import router as _logs_router
from web.routes.ops import router as _ops_router
from web.routes.services import router as _services_router
from web.routes.settings import router as _settings_router
from web.routes.system import router as _system_router
from web.routes.tests import router as _tests_router
from web.routes.webhooks import router as _webhooks_router

from web.services import collect_entrypoints as _collect_entrypoints
from web.services import cursor_proxy as _cursor_proxy
from web.services import cursor_proxy_facade as _cursor_proxy_facade

logger = logging.getLogger(__name__)

APP_BUILD = _app_constants.APP_BUILD
CURSOR_AGENT_UNAVAILABLE_MSG = _app_constants.CURSOR_AGENT_UNAVAILABLE_MSG

templates = _templates_boot.create_templates(base_dir=Path(__file__).resolve().parents[1])

init_db = _db_opt.init_db  # type: ignore[assignment]
db_stats = _db_opt.db_stats  # type: ignore[assignment]
SQLITE_AVAILABLE = bool(_db_opt.SQLITE_AVAILABLE)

save_snapshot = _collect_entrypoints.save_snapshot
save_snapshot_partial = _collect_entrypoints.save_snapshot_partial
maybe_save_partial = _collect_entrypoints.maybe_save_partial
run_collect_sync = _collect_entrypoints.run_collect_sync
do_collect = _collect_entrypoints.do_collect
collect_loop = _collect_entrypoints.collect_loop


def sync_cursor_proxy_from_config(cfg: dict) -> dict:
    """Sync embedded Cursor proxy settings from config."""
    return _cursor_proxy_facade.sync_cursor_proxy_from_config(_cursor_proxy, cfg)


def shutdown_embedded_cursor_proxy() -> None:
    """Shutdown embedded Cursor proxy (best-effort)."""
    return _cursor_proxy_facade.shutdown_embedded_cursor_proxy(_cursor_proxy)


lifespan = _app_lifespan_wiring.make_app_lifespan(
    load_cfg=_load_yaml_config,
    sqlite_available=SQLITE_AVAILABLE,
    init_db=init_db,
    app_build=APP_BUILD,
    config_path=_config_yaml_path,
    sync_cursor_proxy_from_config=sync_cursor_proxy_from_config,
    shutdown_embedded_cursor_proxy=shutdown_embedded_cursor_proxy,
    collect_state=_rt.collect_state,
    collect_loop=collect_loop,
    logger=logger,
)


app = FastAPI(title="CI/CD Monitor", version="1.0.0", lifespan=lifespan)
app.openapi = _openapi_safe.make_safe_openapi(app, logger=logger)

_static_mount.mount_static_if_present(app=app, base_dir=Path(__file__).resolve().parents[1])


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    """Attach request id to response headers."""
    return await _request_id.add_request_id_middleware(request, call_next)


def rid(request: Request | None) -> str:
    """Return request-id for logs."""
    return _request_id.rid(request)


for __r in (
    _ops_router,
    _incident_router,
    _collect_router,
    _builds_router,
    _tests_router,
    _services_router,
    _system_router,
    _settings_router,
    _chat_router,
    _dashboard_router,
    _actions_router,
    _logs_router,
    _webhooks_router,
):
    _router_include.include_routers(app, [__r])
