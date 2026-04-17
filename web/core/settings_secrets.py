"""Settings secret masking / merge helpers."""

from __future__ import annotations

from typing import Any

SETTINGS_SECRET_MASK = "••••••••"


def is_secret_settings_key(key: str) -> bool:
    """Return True if config key likely contains a secret."""
    lk = key.lower()
    if lk in ("token", "password", "api_key", "bot_token", "private_token", "secret"):
        return True
    if lk == "username":
        return False
    for frag in ("password", "api_key", "secret", "token"):
        if frag in lk:
            return True
    return False


def mask_settings_for_response(obj: Any) -> Any:
    """Mask secrets in nested dict/list structures for API responses."""
    if isinstance(obj, dict):
        out: dict[str, Any] = {}
        for k, v in obj.items():
            if is_secret_settings_key(k) and isinstance(v, str) and v.strip():
                out[k] = SETTINGS_SECRET_MASK
            else:
                out[k] = mask_settings_for_response(v)
        return out
    if isinstance(obj, list):
        return [mask_settings_for_response(x) for x in obj]
    return obj


def merge_settings_secrets(incoming: Any, saved: Any) -> Any:
    """Keep previous secret values when the client sends the mask placeholder or empty."""
    if isinstance(incoming, dict) and isinstance(saved, dict):
        out: dict[str, Any] = {}
        for k, v in incoming.items():
            sv = saved.get(k)
            if is_secret_settings_key(k) and isinstance(v, str):
                if v == SETTINGS_SECRET_MASK or (
                    not v.strip() and isinstance(sv, str) and sv.strip()
                ):
                    out[k] = sv if isinstance(sv, str) else v
                else:
                    out[k] = v
            elif isinstance(v, dict) and isinstance(sv, dict):
                out[k] = merge_settings_secrets(v, sv)
            elif isinstance(v, list) and isinstance(sv, list):
                merged: list[Any] = []
                for i, item in enumerate(v):
                    s_item = sv[i] if i < len(sv) else None
                    if isinstance(item, dict) and isinstance(s_item, dict):
                        merged.append(merge_settings_secrets(item, s_item))
                    else:
                        merged.append(item)
                out[k] = merged
            else:
                out[k] = v
        return out
    return incoming
