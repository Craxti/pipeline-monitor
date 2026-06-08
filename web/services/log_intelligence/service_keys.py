"""Service identity keys for analysis models and incidents."""

from __future__ import annotations


def make_service_key(*, kind: str, name: str, source_instance: str = "") -> str:
    k = str(kind or "unknown").strip().lower()
    n = str(name or "").strip()
    host = str(source_instance or "").strip()
    return f"{host}::{k}::{n}"


def parse_service_key(key: str) -> tuple[str, str, str]:
    """Return (source_instance, kind, name). Supports legacy ``host::container`` (docker)."""
    raw = str(key or "").strip()
    if not raw or "::" not in raw:
        raise ValueError("Invalid service key")
    parts = raw.split("::")
    if len(parts) == 2:
        return parts[0], "docker", parts[1]
    if len(parts) >= 3:
        return parts[0], parts[1], "::".join(parts[2:])
    raise ValueError("Invalid service key")
