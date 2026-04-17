"""Runtime container for per-instance health information."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class InstanceHealthRuntime:
    """Holds last known instance health list."""
    health: list[dict[str, Any]] = field(default_factory=list)

def set_health(rt: InstanceHealthRuntime, h: list[dict[str, Any]]) -> None:
    """Replace current health list."""
    rt.health = h


def get_health(rt: InstanceHealthRuntime) -> list[dict[str, Any]]:
    """Return current health list."""
    return rt.health
