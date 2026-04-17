"""Notifications: detect state changes between snapshots."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable, List, Optional, Tuple

from models.models import CISnapshot


EventAppender = Callable[[List[dict]], None]


def detect_state_changes(
    snapshot: CISnapshot,
    *,
    prev_build_statuses: dict[str, str],
    prev_svc_statuses: dict[str, str],
    prev_incident_active: bool,
    prev_incident_sig: Tuple[int, int, int, bool],
    notify_id_seq: int,
    notifications: List[dict],
    notify_max: int,
    append_event: Optional[EventAppender] = None,
) -> Tuple[dict[str, str], dict[str, str], bool, Tuple[int, int, int, bool], int]:
    """Diff snapshot vs previous; append notification events."""
    now_iso = datetime.now(tz=timezone.utc).isoformat()
    fail_st = {"failure", "unstable"}
    ok_st = {"success"}

    # Latest build per job (snapshot.builds newest-first)
    latest: dict[str, object] = {}
    for b in reversed(snapshot.builds):
        latest[getattr(b, "job_name", "")] = b

    for job_name, b in latest.items():
        if not job_name:
            continue
        prev = prev_build_statuses.get(job_name)
        curr = (
            b.status
            if isinstance(getattr(b, "status", None), str)
            else getattr(getattr(b, "status", None), "value", None)
        )
        curr = curr if isinstance(curr, str) else str(curr)
        if prev is not None and prev != curr:
            if curr in fail_st and prev in ok_st:
                notify_id_seq += 1
                ev: dict[str, Any] = {
                    "id": notify_id_seq,
                    "ts": now_iso,
                    "kind": "build_fail",
                    "level": "error",
                    "title": f"Job FAILED: {job_name}",
                    "detail": f"Status changed {prev} → {curr}",
                    "url": getattr(b, "url", None),
                    "critical": bool(getattr(b, "critical", False)),
                }
                notifications.append(ev)
                if append_event:
                    append_event([ev])
            elif curr in ok_st and prev in fail_st:
                notify_id_seq += 1
                ev = {
                    "id": notify_id_seq,
                    "ts": now_iso,
                    "kind": "build_recovered",
                    "level": "ok",
                    "title": f"Job RECOVERED: {job_name}",
                    "detail": f"Status changed {prev} → {curr}",
                    "url": getattr(b, "url", None),
                    "critical": bool(getattr(b, "critical", False)),
                }
                notifications.append(ev)
                if append_event:
                    append_event([ev])
        prev_build_statuses[job_name] = curr

    for svc in snapshot.services:
        name = getattr(svc, "name", "") or ""
        if not name:
            continue
        prev = prev_svc_statuses.get(name)
        curr = str(getattr(svc, "status", "") or "")
        if prev is not None and prev != curr:
            if curr == "down" and prev in ("up", "degraded"):
                notify_id_seq += 1
                ev = {
                    "id": notify_id_seq,
                    "ts": now_iso,
                    "kind": "svc_down",
                    "level": "error",
                    "title": f"Service DOWN: {name}",
                    "detail": f"Was {prev}, now down. {getattr(svc, 'detail', '') or ''}",
                }
                notifications.append(ev)
                if append_event:
                    append_event([ev])
            elif curr == "up" and prev == "down":
                notify_id_seq += 1
                ev = {
                    "id": notify_id_seq,
                    "ts": now_iso,
                    "kind": "svc_recovered",
                    "level": "ok",
                    "title": f"Service UP: {name}",
                    "detail": f"Recovered from {prev}",
                }
                notifications.append(ev)
                if append_event:
                    append_event([ev])
        prev_svc_statuses[name] = curr

    # Incident (aggregate) notification: emit once when an incident first appears.
    try:
        failed_builds = sum(
            1 for b in snapshot.builds if getattr(b, "status_normalized", None) in fail_st
        )
        failed_tests = sum(
            1
            for t in snapshot.tests
            if getattr(t, "status_normalized", None) in ("failed", "error")
        )
        down_svcs = sum(
            1 for s in snapshot.services if getattr(s, "status_normalized", None) == "down"
        )
        has_critical = any(
            bool(getattr(b, "critical", False))
            and getattr(b, "status_normalized", None) in fail_st
            for b in snapshot.builds
        )
        active = (failed_builds > 0) or (failed_tests > 0) or (down_svcs > 0)
        sig = (failed_builds, failed_tests, down_svcs, bool(has_critical))
        if active and not prev_incident_active:
            notify_id_seq += 1
            lvl = "error" if (down_svcs > 0 or has_critical) else "warn"
            ev = {
                "id": notify_id_seq,
                "ts": now_iso,
                "kind": "incident",
                "level": lvl,
                "title": "Incident detected",
                "detail": (
                    f"Failed builds: {failed_builds}, "
                    f"failed tests: {failed_tests}, "
                    f"services down: {down_svcs}"
                ),
                "url": "/?tab=incidents",
                "critical": bool(has_critical) or (down_svcs > 0),
            }
            notifications.append(ev)
            if append_event:
                append_event([ev])
        prev_incident_active = active
        prev_incident_sig = sig
    except Exception:
        # Never block build/service notifications on incident aggregation.
        pass

    # Trim ring-buffer
    if notify_max > 0 and len(notifications) > notify_max:
        del notifications[: len(notifications) - notify_max]

    return (
        prev_build_statuses,
        prev_svc_statuses,
        prev_incident_active,
        prev_incident_sig,
        notify_id_seq,
    )
