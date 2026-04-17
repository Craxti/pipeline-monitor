"""Progress update helpers for collection runs."""

from __future__ import annotations


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
