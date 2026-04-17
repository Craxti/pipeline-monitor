from __future__ import annotations

import os
from typing import Optional

from fastapi import Header, HTTPException, Request

from web.core.config import load_yaml_config


def shared_api_token(cfg: Optional[dict] = None) -> str:
    """
    Shared token for protecting sensitive endpoints.
    Sources (highest priority first):
    - env: CICD_MON_API_TOKEN
    - config.yaml: web.api_token
    If empty, auth is considered disabled (backwards-compatible).
    """
    env_tok = (os.getenv("CICD_MON_API_TOKEN") or "").strip()
    if env_tok:
        return env_tok
    if not cfg:
        try:
            cfg = load_yaml_config()
        except Exception:
            cfg = None
    if cfg:
        w = cfg.get("web", {}) or {}
        tok = (w.get("api_token") or "").strip()
        if tok:
            return tok
    return ""


def token_from_headers(x_api_token: Optional[str], authorization: Optional[str]) -> str:
    if x_api_token:
        return str(x_api_token).strip()
    if authorization:
        raw = str(authorization).strip()
        if raw.lower().startswith("bearer "):
            return raw.split(" ", 1)[1].strip()
    return ""


async def require_shared_token(
    request: Request,
    x_api_token: Optional[str] = Header(default=None, alias="X-API-Token"),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> None:
    cfg = None
    try:
        cfg = load_yaml_config()
    except Exception:
        cfg = None
    expected = shared_api_token(cfg)
    if not expected:
        # Backwards-compatible: if token is not configured, do not block.
        return
    provided = token_from_headers(x_api_token, authorization)
    if not provided or provided != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")
