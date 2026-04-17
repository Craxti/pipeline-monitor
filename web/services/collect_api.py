"""Helpers for collect-related API payloads (status + auto toggle parsing)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def parse_enabled(body: Any) -> bool:
    """Parse `enabled` flag from JSON body."""
    return bool(
        isinstance(body, dict)
        and body.get("enabled") in (True, "true", "1", 1)
    )


def collect_status_payload(
    *,
    collect_state: dict,
    auto_collect_enabled: bool,
    auto_collect_enabled_at_iso: str | None,
) -> dict:
    """Build collection status response for the UI."""
    next_in = None
    try:
        if auto_collect_enabled and not collect_state.get("is_collecting"):
            interval = int(collect_state.get("interval_seconds") or 300)
            if collect_state.get("last_collected_at"):
                next_in = max(
                    0,
                    interval
                    - int(
                        (
                            datetime.now(tz=timezone.utc)
                            - datetime.fromisoformat(collect_state["last_collected_at"])
                        ).total_seconds()
                    ),
                )
            elif auto_collect_enabled_at_iso:
                try:
                    enabled_at = datetime.fromisoformat(str(auto_collect_enabled_at_iso))
                    if enabled_at.tzinfo is None:
                        enabled_at = enabled_at.replace(tzinfo=timezone.utc)
                    else:
                        enabled_at = enabled_at.astimezone(timezone.utc)
                    next_in = max(
                        0,
                        interval
                        - int(
                            (
                                datetime.now(tz=timezone.utc) - enabled_at
                            ).total_seconds()
                        ),
                    )
                except Exception:
                    next_in = None
    except Exception:
        next_in = None
    return {
        **collect_state,
        "auto_collect_enabled": bool(auto_collect_enabled),
        "next_collect_in_seconds": next_in,
    }
