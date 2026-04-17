"""AI chat streaming and diagnostics."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from web.core.auth import require_shared_token

router = APIRouter(tags=["chat"])


@router.post(
    "/api/chat",
    dependencies=[Depends(require_shared_token)],
)
async def api_chat_route(request: Request):
    """Main AI chat endpoint."""
    from web.core.config import config_yaml_path, load_yaml_config
    from web.services import (
        ai_helpers,
        ai_provider_bases,
        app_constants,
        chat_endpoints,
        cursor_proxy,
    )

    return await chat_endpoints.api_chat(
        request,
        load_yaml_config=load_yaml_config,
        config_yaml_path=config_yaml_path,
        ai_default_model=ai_helpers.ai_default_model,
        looks_like_upstream_unreachable=ai_helpers.looks_like_upstream_unreachable,
        openai_proxy_url=ai_helpers.openai_proxy_url,
        resolve_cursor_agent_cached=cursor_proxy.resolve_cursor_agent_cached,
        cursor_agent_unavailable_msg=app_constants.CURSOR_AGENT_UNAVAILABLE_MSG,
        provider_bases=ai_provider_bases.PROVIDER_BASES,
    )


@router.get(
    "/api/chat/status",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def api_chat_status_route():
    """Return chat/proxy status and config-derived defaults."""
    from web.core.config import config_yaml_path, load_yaml_config
    from web.services import ai_helpers, app_constants, chat_endpoints, cursor_proxy

    return await chat_endpoints.api_chat_status(
        load_yaml_config=load_yaml_config,
        config_yaml_path=config_yaml_path,
        openai_proxy_url=ai_helpers.openai_proxy_url,
        ai_default_model=ai_helpers.ai_default_model,
        resolve_cursor_agent_cached=cursor_proxy.resolve_cursor_agent_cached,
        app_build=app_constants.APP_BUILD,
        cursor_proxy_running=cursor_proxy.cursor_proxy_running,
        cursor_proxy_autostart_enabled=cursor_proxy.cursor_proxy_autostart_enabled,
    )


@router.get(
    "/api/chat/proxy-check",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def api_chat_proxy_check_route():
    """Run a proxy connectivity check with rate limiting."""
    from web.core.config import config_yaml_path, load_yaml_config
    from web.core import runtime as rt
    from web.services import ai_helpers, chat_endpoints, runtime_helpers

    return await chat_endpoints.api_chat_proxy_check(
        check_rate_limit=lambda key, window=15: runtime_helpers.check_rate_limit(
            rt.rate_limit_rt.store,
            key,
            window=window,
        ),
        load_yaml_config=load_yaml_config,
        config_yaml_path=config_yaml_path,
        openai_proxy_url=ai_helpers.openai_proxy_url,
        http_probe_public_ip=ai_helpers.http_probe_public_ip,
    )


@router.get(
    "/api/proxy-check",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def api_proxy_check_alias_route():
    """Alias for chat proxy-check endpoint."""
    return await api_chat_proxy_check_route()
