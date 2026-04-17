"""Helpers for collect triggers (manual collect endpoint)."""

from __future__ import annotations

from typing import Any


def parse_force_full(body: Any) -> bool:
    return bool(isinstance(body, dict) and body.get("force_full") in (True, "true", "1", 1))


def started_payload() -> dict[str, Any]:
    return {"ok": True, "message": "Collection started."}
