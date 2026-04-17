"""Helper utilities for the AI chat endpoints."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx


def ai_default_model(provider: str) -> str:
    return {
        "openai": "gpt-4o-mini",
        "gemini": "gemini-2.0-flash",
        "openrouter": "google/gemini-2.0-flash-exp:free",
        "cursor": "auto",
        "ollama": "llama3.1:8b",
        "custom": "gpt-4o-mini",
    }.get(provider, "gpt-4o-mini")


def looks_like_upstream_unreachable(err_text: str) -> bool:
    low = (err_text or "").lower()
    return any(
        s in low
        for s in (
            "connection refused",
            "failed to connect",
            "errno 111",
            "errno 61",
            "10061",  # Windows: connection refused
            "winerror 10061",
            "name or service not known",
            "getaddrinfo failed",
            "timed out",
            "connect error",
            "connection reset",
        )
    )


def openai_proxy_url(ai_cfg: dict) -> str | None:
    """Build httpx proxy URL from config (HTTP, HTTPS, SOCKS5). Returns None if disabled."""
    proxy = ai_cfg.get("proxy")
    if not isinstance(proxy, dict) or not proxy.get("enabled"):
        return None
    raw = (proxy.get("url") or "").strip()
    if raw:
        low = raw.lower()
        if low.startswith("socks5://") and not low.startswith("socks5h://"):
            raw = "socks5h://" + raw[9:]
        return raw
    host = (proxy.get("host") or "").strip()
    try:
        port = int(proxy.get("port") or 0)
    except (TypeError, ValueError):
        port = 0
    if not host or port <= 0:
        return None
    ptype = (proxy.get("type") or "http").strip().lower()
    if ptype not in ("http", "https", "socks5", "socks5h"):
        ptype = "http"
    if ptype == "socks5":
        ptype = "socks5h"
    user = (proxy.get("username") or "").strip()
    password = (proxy.get("password") or "").strip()
    auth = ""
    if user or password:
        auth = f"{quote(user, safe='')}:{quote(password, safe='')}@"
    return f"{ptype}://{auth}{host}:{port}"


async def http_probe_public_ip(client: httpx.AsyncClient) -> tuple[str | None, str | None]:
    """Return (ip, error_message). Used to verify proxy egress vs direct connection."""
    last_err = "unknown"
    try:
        r = await client.get("https://api.ipify.org", params={"format": "json"}, timeout=20.0)
        r.raise_for_status()
        ip = r.json().get("ip")
        if ip:
            return str(ip), None
        last_err = "ipify returned no ip"
    except Exception as exc:
        last_err = str(exc)
    try:
        r = await client.get("https://icanhazip.com", timeout=20.0)
        r.raise_for_status()
        line = (r.text or "").strip().splitlines()[0].strip()
        if line:
            return line, None
        last_err = "icanhazip empty body"
    except Exception as exc:
        last_err = str(exc)
    return None, last_err

