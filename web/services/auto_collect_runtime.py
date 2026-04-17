from __future__ import annotations

from dataclasses import dataclass


@dataclass
class AutoCollectRuntime:
    enabled: bool = False
    enabled_at_iso: str | None = None

