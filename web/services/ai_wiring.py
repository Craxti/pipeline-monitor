"""Thin wrappers for AI helper functions."""

from __future__ import annotations

import httpx


def ai_default_model(ai_helpers_mod, provider: str) -> str:
    """Return default model for provider."""
    return ai_helpers_mod.ai_default_model(provider)


def looks_like_upstream_unreachable(ai_helpers_mod, err_text: str) -> bool:
    """Detect upstream connectivity issues from error text."""
    return ai_helpers_mod.looks_like_upstream_unreachable(err_text)


def openai_proxy_url(ai_helpers_mod, ai_cfg: dict) -> str | None:
    """Return proxy URL for OpenAI-compatible API, if configured."""
    return ai_helpers_mod.openai_proxy_url(ai_cfg)


async def http_probe_public_ip(
    ai_helpers_mod,
    client: httpx.AsyncClient,
) -> tuple[str | None, str | None]:
    """Probe public IP using the configured HTTP client."""
    return await ai_helpers_mod.http_probe_public_ip(client)
