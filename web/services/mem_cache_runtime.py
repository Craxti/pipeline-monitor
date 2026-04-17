"""Runtime container for the in-memory TTL cache."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class MemCacheRuntime:
    """Holds TTL cache store and defaults."""

    store: dict[str, tuple[float, Any]] = field(default_factory=dict)
    ttl_seconds: float = 20.0


def get(mem_cache_mod, rt: MemCacheRuntime, key: str) -> Any | None:
    """Read from runtime mem-cache."""
    return mem_cache_mod.mem_cache_get(rt.store, key)


def set_value(
    mem_cache_mod,
    rt: MemCacheRuntime,
    key: str,
    val: Any,
    ttl_seconds: float | None = None,
) -> None:
    """Write to runtime mem-cache."""
    return mem_cache_mod.mem_cache_set(
        rt.store,
        key,
        val,
        ttl_seconds=float(ttl_seconds or rt.ttl_seconds),
    )


# Backward-compatible alias (avoid breaking older imports)
set = set_value  # type: ignore[assignment]  # pylint: disable=redefined-builtin
