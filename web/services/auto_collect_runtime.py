"""Runtime container for the auto-collect toggle."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class AutoCollectRuntime:
    """Holds LIVE-mode auto-collect state."""
    enabled: bool = False
    enabled_at_iso: str | None = None
