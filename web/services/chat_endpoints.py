"""Chat endpoints (SSE streaming) for AI assistant."""

from __future__ import annotations

import json
import logging
from typing import Any, Awaitable, Callable

import httpx
from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse

from web.services.chat_prompts import get_text, resolve_lang

logger = logging.getLogger(__name__)


async def api_chat(
    request: Request,
    *,
    load_yaml_config: Callable[[], dict],
    config_yaml_path: Callable[[], Any],
    ai_default_model: Callable[[str], str],
    looks_like_upstream_unreachable: Callable[[str], bool],
    openai_proxy_url: Callable[[dict], str | None],
    resolve_cursor_agent_cached: Callable[[dict], str | None],
    cursor_agent_unavailable_msg: str,
    provider_bases: dict[str, str],
) -> StreamingResponse:
    """Stream chat completion tokens as SSE events."""
    cfg = load_yaml_config()
    ai_cfg = cfg.get("openai", {})
    provider = ai_cfg.get("provider", "openai")
    api_key = ai_cfg.get("api_key", "").strip()
    if not api_key:
        if provider == "cursor":
            api_key = "unused"
        elif provider == "ollama":
            api_key = "ollama"
        else:
            raise HTTPException(
                400,
                "API key not configured. Go to Settings → AI Assistant and enter your key.",
            )

    body = await request.json()
    user_messages = body.get("messages", [])
    if not user_messages:
        raise HTTPException(400, "messages list is required")

    context_text = body.get("context", "")
    ui_location = str(body.get("ui_location") or "").strip()
    lang = resolve_lang(body.get("lang"), user_messages)
    model = (ai_cfg.get("model") or "").strip() or ai_default_model(provider)

    system_prompt = get_text("system_base", lang=lang)
    if ui_location:
        system_prompt += "\n\n=== Current UI location ===\n" + ui_location[:2000]
    if context_text:
        system_prompt += "\n\nCurrent dashboard context (optional snapshot from the UI):\n" + context_text[:12000]

    messages = [{"role": "system", "content": system_prompt}]
    for m in user_messages[-20:]:
        role = m.get("role", "user")
        if role in ("user", "assistant"):
            messages.append({"role": role, "content": m.get("content", "")})

    from openai import AsyncOpenAI

    proxy_url = openai_proxy_url(ai_cfg)
    base_url = (ai_cfg.get("base_url") or "").strip() or provider_bases.get(provider, "")
    timeout = httpx.Timeout(120.0, connect=60.0)
    px_cfg = ai_cfg.get("proxy") if isinstance(ai_cfg.get("proxy"), dict) else {}
    if px_cfg.get("enabled") and not proxy_url:
        logger.warning(
            "OpenAI proxy enabled in config but URL is incomplete — check host/port " "or full url (config=%s)",
            config_yaml_path(),
        )

    async def generate():
        http_client: httpx.AsyncClient | None = None
        try:
            if provider == "cursor" and not resolve_cursor_agent_cached(cfg):
                yield f"data: {json.dumps({'error': cursor_agent_unavailable_msg})}\n\n"
                yield "data: [DONE]\n\n"
                return

            client_kw: dict = {"api_key": api_key}
            if base_url:
                client_kw["base_url"] = base_url
            if proxy_url:
                http_client = httpx.AsyncClient(
                    proxies=proxy_url,
                    timeout=timeout,
                    trust_env=False,
                )
                client_kw["http_client"] = http_client
                logger.info(
                    "OpenAI chat using explicit proxy (scheme=%s)",
                    proxy_url.split("://", 1)[0] if "://" in proxy_url else "?",
                )
            client = AsyncOpenAI(**client_kw)
            stream = await client.chat.completions.create(
                model=model,
                messages=messages,
                stream=True,
                max_tokens=3000,
                temperature=0.4,
            )
            yielded_text = False
            async for chunk in stream:
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta and delta.content:
                    yielded_text = True
                    yield f"data: {json.dumps({'t': delta.content})}\n\n"
            if not yielded_text:
                empty_msg = (
                    get_text("empty_response_cursor", lang=lang)
                    if provider == "cursor"
                    else get_text("empty_response_generic", lang=lang)
                )
                yield f"data: {json.dumps({'error': empty_msg})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:
            msg = str(exc)
            if provider == "cursor" and looks_like_upstream_unreachable(msg):
                msg = get_text("cursor_upstream_unreachable", lang=lang)
            elif "unsupported_country" in msg or "unsupported_country_region_territory" in msg:
                msg += " — " + get_text("geo_block_suffix", lang=lang)
            yield f"data: {json.dumps({'error': msg})}\n\n"
        finally:
            if http_client is not None:
                await http_client.aclose()

    return StreamingResponse(generate(), media_type="text/event-stream")


async def api_chat_status(
    *,
    load_yaml_config: Callable[[], dict],
    config_yaml_path: Callable[[], Any],
    openai_proxy_url: Callable[[dict], str | None],
    ai_default_model: Callable[[str], str],
    resolve_cursor_agent_cached: Callable[[dict], str | None],
    app_build: str,
    cursor_proxy_running: Callable[[], bool],
    cursor_proxy_autostart_enabled: Callable[[dict], bool],
) -> dict:
    """Return configuration + embedded proxy status for UI."""
    cfg = load_yaml_config()
    ai_cfg = cfg.get("openai", {})
    prov = ai_cfg.get("provider", "openai")
    has_key = bool(ai_cfg.get("api_key", "").strip()) or prov in ("cursor", "ollama")
    proxy_ok = openai_proxy_url(ai_cfg) is not None
    px = ai_cfg.get("proxy") if isinstance(ai_cfg.get("proxy"), dict) else {}
    proxy_on = bool(px.get("enabled")) and proxy_ok
    model = (ai_cfg.get("model") or "").strip() or ai_default_model(prov)
    cursor_agent_path: str | None = None
    if prov == "cursor":
        cursor_agent_path = resolve_cursor_agent_cached(cfg)
    return {
        "configured": has_key,
        "provider": prov,
        "model": model,
        "proxy_enabled": proxy_on,
        "proxy_misconfigured": bool(px.get("enabled")) and not proxy_ok,
        "config_path": str(config_yaml_path()),
        "app_build": app_build,
        "cursor_proxy_embedded": cursor_proxy_running(),
        "cursor_proxy_autostart": cursor_proxy_autostart_enabled(cfg),
        "cursor_agent_found": cursor_agent_path is not None if prov == "cursor" else None,
        "cursor_agent_path": cursor_agent_path if prov == "cursor" else None,
    }


async def api_chat_proxy_check(
    *,
    check_rate_limit: Callable[..., None],
    load_yaml_config: Callable[[], dict],
    config_yaml_path: Callable[[], Any],
    openai_proxy_url: Callable[[dict], str | None],
    http_probe_public_ip: Callable[[httpx.AsyncClient], Awaitable[tuple[str | None, str | None]]],
) -> dict:
    """Check direct vs proxied connectivity."""
    check_rate_limit("chat:proxy-check", window=10.0)
    cfg = load_yaml_config()
    ai_cfg = cfg.get("openai", {})
    proxy_url = openai_proxy_url(ai_cfg)
    timeout = httpx.Timeout(30.0, connect=25.0)

    out: dict = {
        "config_path": str(config_yaml_path()),
        "proxy_active": bool(proxy_url),
        "proxy_scheme": proxy_url.split("://", 1)[0] if proxy_url and "://" in proxy_url else None,
        "direct": None,
        "via_proxy": None,
    }

    try:
        async with httpx.AsyncClient(timeout=timeout, trust_env=True) as dc:
            dip, derr = await http_probe_public_ip(dc)
            out["direct"] = {"ok": derr is None and bool(dip), "ip": dip, "error": derr}
    except Exception as exc:
        out["direct"] = {"ok": False, "ip": None, "error": str(exc)}

    if proxy_url:
        try:
            async with httpx.AsyncClient(proxies=proxy_url, timeout=timeout, trust_env=False) as pc:
                pip, perr = await http_probe_public_ip(pc)
                out["via_proxy"] = {"ok": perr is None and bool(pip), "ip": pip, "error": perr}
        except Exception as exc:
            out["via_proxy"] = {"ok": False, "ip": None, "error": str(exc)}
    else:
        px = ai_cfg.get("proxy") if isinstance(ai_cfg.get("proxy"), dict) else {}
        if px.get("enabled"):
            out["via_proxy"] = {
                "ok": False,
                "ip": None,
                "error": "Proxy is enabled but host/port (or full URL) is missing or invalid.",
            }
    return out
