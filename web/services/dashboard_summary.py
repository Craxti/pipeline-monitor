"""Compute a compact dashboard summary payload."""

from __future__ import annotations

from typing import Any, Callable

from web.services import freshness as _freshness
from web.services import status_policy as _sp


def dashboard_summary_payload(
    *,
    load_yaml_config: Callable[[], dict],
    load_snapshot: Callable[[], Any],
    collect_state: dict,
    instance_health: list[dict[str, Any]],
    data_revision: int,
) -> dict[str, Any]:
    """Build the dashboard summary for the UI."""
    cfg = load_yaml_config()
    w_cfg = cfg.get("web", {})
    interval = int(w_cfg.get("collect_interval_seconds", 300))
    stale_threshold = interval * 2

    snap = load_snapshot()
    counts: dict[str, int] = {
        "builds": 0,
        "failed_builds": 0,
        "failed_tests": 0,
        "tests_total": 0,
        "services_down": 0,
    }
    if snap:
        counts["builds"] = len(getattr(snap, "builds", []) or [])
        counts["failed_builds"] = sum(
            1
            for b in (getattr(snap, "builds", []) or [])
            if _sp.is_build_problem(getattr(b, "status_normalized", None))
        )
        counts["failed_tests"] = sum(
            1
            for t in (getattr(snap, "tests", []) or [])
            if _sp.is_test_problem(getattr(t, "status_normalized", None))
        )
        counts["tests_total"] = len(getattr(snap, "tests", []) or [])
        counts["services_down"] = sum(
            1 for s in (getattr(snap, "services", []) or []) if getattr(s, "status_normalized", None) == "down"
        )

    partial_errors: list[dict[str, Any]] = []
    if collect_state.get("last_error"):
        partial_errors.append({"source": "collect", "message": collect_state["last_error"]})
    for h in instance_health:
        if not h.get("ok"):
            partial_errors.append(
                {
                    "source": h.get("kind"),
                    "name": h.get("name"),
                    "message": h.get("error"),
                }
            )

    collect_last_collected_at = collect_state.get("last_collected_at")
    collect_last_error = collect_state.get("last_error")
    collect_is_collecting = bool(collect_state.get("is_collecting"))

    collect = {
        "is_collecting": collect_is_collecting,
        "last_collected_at": collect_last_collected_at,
        "last_error": collect_last_error,
        "interval_seconds": interval,
        "stop_reason": collect_state.get("stop_reason"),
        "phase_timings_ms": dict(collect_state.get("phase_timings_ms") or {}),
        "incremental_stats": dict(collect_state.get("incremental_stats") or {}),
    }
    try:
        st = collect["incremental_stats"]
        ch = int(st.get("jenkins_checked", 0) or 0) + int(st.get("gitlab_checked", 0) or 0)
        sk = int(st.get("jenkins_skipped", 0) or 0) + int(st.get("gitlab_skipped", 0) or 0)
        collect["incremental_skip_ratio"] = (float(sk) / float(ch)) if ch > 0 else None
    except Exception:
        collect["incremental_skip_ratio"] = None

    parse_coverage = (getattr(snap, "collect_meta", None) if snap else None) or {}

    return {
        "data_revision": data_revision,
        "snapshot": _freshness.snapshot_freshness(snap=snap, stale_threshold_seconds=stale_threshold),
        "counts": counts,
        "collect": collect,
        "partial_errors": partial_errors,
        "instance_health": list(instance_health),
        "parse_coverage": parse_coverage,
    }
