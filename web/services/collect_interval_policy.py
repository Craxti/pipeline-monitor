"""Collect interval: base from config vs faster cycle when dashboard LIVE is on."""

from __future__ import annotations


def clamp_live_dashboard_poll_seconds(raw: object) -> int:
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return 20
    return max(8, min(n, 120))


def clamp_live_collect_interval_seconds(raw: object, *, base: int) -> int:
    try:
        n = int(raw)
    except (TypeError, ValueError):
        n = 90
    base = max(5, int(base))
    return max(20, min(n, base))


def effective_collect_interval_seconds(
    w_cfg: dict,
    *,
    dashboard_live_fast_collect: bool,
) -> int:
    """Background loop sleep after a full collect. LIVE (dashboard) can shorten it."""
    base = int(w_cfg.get("collect_interval_seconds", 300) or 300)
    base = max(5, base)
    if not dashboard_live_fast_collect:
        return base
    live = clamp_live_collect_interval_seconds(
        w_cfg.get("live_collect_interval_seconds", 90),
        base=base,
    )
    return live
