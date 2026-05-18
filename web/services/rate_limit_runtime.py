"""Runtime container for rate limiting store."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class RateLimitRuntime:
    """Holds per-key timestamp store for rate limiting."""

    store: dict[str, float] = field(default_factory=dict)
    default_window_seconds: float = 15.0


def check(runtime_helpers_mod, rt: RateLimitRuntime, key: str, window: float | None = None) -> None:
    """Check rate limit and raise if exceeded."""
    return runtime_helpers_mod.check_rate_limit(
        rt.store,
        key,
        window=float(window or rt.default_window_seconds),
    )
