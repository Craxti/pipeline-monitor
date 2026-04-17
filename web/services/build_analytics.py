"""Build analytics helpers.

Extracted from ``web.app`` to keep the main module small and reusable.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import timezone
from typing import Any

from models.models import CISnapshot


def status_str(val: object) -> str:
    if isinstance(val, str):
        return val
    return getattr(val, "value", str(val))


def job_build_analytics(snapshot: CISnapshot) -> dict[str, dict]:
    """Per job: consecutive failures from latest run, last successful build number."""
    by_job: dict[str, list] = defaultdict(list)
    for b in snapshot.builds:
        by_job[b.job_name].append(b)

    out: dict[str, dict] = {}
    for job, builds in by_job.items():

        def sort_key(bn: Any) -> tuple[float, int]:
            sa = getattr(bn, "started_at", None)
            if sa is None:
                return 0.0, int(getattr(bn, "build_number", 0) or 0)
            if getattr(sa, "tzinfo", None) is None:
                sa = sa.replace(tzinfo=timezone.utc)
            return float(sa.timestamp()), int(getattr(bn, "build_number", 0) or 0)

        builds_sorted = sorted(builds, key=sort_key, reverse=True)
        streak = 0
        for b in builds_sorted:
            if b.status_normalized in ("failure", "unstable"):
                streak += 1
            else:
                break
        last_success_number = None
        for b in builds_sorted:
            if b.status_normalized == "success":
                last_success_number = b.build_number
                break
        latest = builds_sorted[0] if builds_sorted else None
        out[job] = {
            "consecutive_failures": streak,
            "last_success_build_number": last_success_number,
            "latest_status": status_str(latest.status) if latest else None,
        }
    return out
