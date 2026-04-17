from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class InstanceHealthRuntime:
    health: list[dict[str, Any]] = field(default_factory=list)


def set_health(rt: InstanceHealthRuntime, h: list[dict[str, Any]]) -> None:
    rt.health = h


def get_health(rt: InstanceHealthRuntime) -> list[dict[str, Any]]:
    return rt.health

