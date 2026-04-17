"""Meta endpoint payload builder (summary + analytics)."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from web.services import freshness as _freshness


async def meta_payload(
    *,
    load_yaml_config: Callable[[], dict],
    load_snapshot_async: Callable[[], Awaitable[Any]],
    job_build_analytics: Callable[[Any], dict],
    correlation_last_hour: Callable[[], dict],
    collect_state: dict,
    data_revision: int,
) -> dict[str, Any]:
    """Build a meta payload used by the frontend for quick polling."""
    cfg = load_yaml_config()
    w_cfg = cfg.get("web", {})
    interval = int(w_cfg.get("collect_interval_seconds", 300))
    stale_threshold = interval * 2

    snap = await load_snapshot_async()
    job_analytics: dict = {}
    if snap:
        job_analytics = job_build_analytics(snap)

    return {
        "data_revision": data_revision,
        "snapshot": _freshness.snapshot_freshness(
            snap=snap, stale_threshold_seconds=stale_threshold
        ),
        "collect": {
            "is_collecting": collect_state["is_collecting"],
            "last_collected_at": collect_state["last_collected_at"],
            "last_error": collect_state["last_error"],
            "interval_seconds": interval,
        },
        "correlation": correlation_last_hour(),
        "job_analytics": job_analytics,
        "parse_coverage": (getattr(snap, "collect_meta", None) if snap else None) or {},
    }
