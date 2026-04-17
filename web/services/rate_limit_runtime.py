from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class RateLimitRuntime:
    store: dict[str, float] = field(default_factory=dict)
    default_window_seconds: float = 15.0


def check(runtime_helpers_mod, rt: RateLimitRuntime, key: str, window: float | None = None) -> None:
    return runtime_helpers_mod.check_rate_limit(rt.store, key, window=float(window or rt.default_window_seconds))

