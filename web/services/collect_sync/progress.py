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
    state_lock=None,
) -> None:
    """Update `collect_state` fields based on snapshot state and phase."""

    def _apply() -> None:
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

        active = collect_state.setdefault("active_progress", {})
        active[phase] = {"main": main, "sub": sub, "ts": now_mono}
        stale_cutoff = now_mono - 20.0
        for key in list(active.keys()):
            try:
                if float(active[key].get("ts", 0) or 0) < stale_cutoff:
                    del active[key]
            except Exception:
                del active[key]
        mains = [v.get("main") or "" for v in sorted(active.values(), key=lambda x: float(x.get("ts", 0) or 0))]
        mains = [m for m in mains if m]
        if len(mains) > 1:
            collect_state["progress_main"] = " · ".join(mains[:5])
            subs = [v.get("sub") for v in active.values() if v.get("sub")]
            collect_state["progress_sub"] = subs[0] if len(subs) == 1 else f"{len(active)} sources in parallel"
        else:
            collect_state["progress_main"] = main
            collect_state["progress_sub"] = sub
        collect_state["active_phases"] = list(active.keys())

        pub = snapshot
        if collect_state.get("is_collecting"):
            try:
                from web.services.snapshot_store import _patch_snapshot_for_collect_publish

                pub = _patch_snapshot_for_collect_publish(snapshot, collect_state)
            except Exception:
                pub = snapshot
        collect_state["progress_counts"] = {
            "builds": len(getattr(pub, "builds", None) or []),
            "tests": len(getattr(pub, "tests", None) or []),
            "services": len(getattr(pub, "services", None) or []),
        }
        lvl = "info"
        s = (sub or "").lower()
        if " error" in s or "failed" in s or "exception" in s or "traceback" in s or "retry" in s:
            lvl = "warn"
        push_collect_log(phase, main, sub, lvl)

    if state_lock is not None:
        with state_lock:
            _apply()
    else:
        _apply()
