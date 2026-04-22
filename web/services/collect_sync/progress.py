"""Progress update helpers for collection runs."""

from __future__ import annotations

import time

from web.services.collect_sync.exceptions import CollectCancelled


def progress_update(
    *,
    collect_state: dict,
    snapshot,
    phase: str,
    main: str,
    sub: str | None,
    push_collect_log,
) -> None:
    """Update `collect_state` fields based on snapshot state and phase."""
    if collect_state.get("cancel_requested"):
        raise CollectCancelled("Stopped by user")
    now_mono = time.monotonic()
    prev_phase = collect_state.get("_phase_timing_phase")
    prev_started = collect_state.get("_phase_timing_started")
    if prev_phase and prev_started and prev_phase != phase:
        try:
            elapsed_ms = max(0, int((now_mono - float(prev_started)) * 1000))
            timings = collect_state.setdefault("phase_timings_ms", {})
            timings[prev_phase] = int(timings.get(prev_phase, 0) or 0) + elapsed_ms
        except Exception:
            pass
    collect_state["_phase_timing_phase"] = phase
    collect_state["_phase_timing_started"] = now_mono
    collect_state["phase"] = phase
    collect_state["progress_main"] = main
    collect_state["progress_sub"] = sub
    collect_state["progress_counts"] = {
        "builds": len(getattr(snapshot, "builds", None) or []),
        "tests": len(getattr(snapshot, "tests", None) or []),
        "services": len(getattr(snapshot, "services", None) or []),
    }
    lvl = "info"
    s = (sub or "").lower()
    if " error" in s or "failed" in s or "exception" in s or "traceback" in s or "retry" in s:
        lvl = "warn"
    push_collect_log(phase, main, sub, lvl)
