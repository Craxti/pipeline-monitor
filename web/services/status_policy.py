"""Unified status/severity policy used by API summaries and UI contracts."""

from __future__ import annotations

from models.models import normalize_build_status, normalize_service_status, normalize_test_status


def is_build_problem(status: object) -> bool:
    """Build statuses that should be treated as incident signals."""
    s = normalize_build_status(status)
    return s in ("failure", "unstable")


def is_test_problem(status: object) -> bool:
    """Test statuses treated as failing in incident logic."""
    s = normalize_test_status(str(status or ""))
    return s in ("failed", "error")


def incident_severity(
    *,
    services_down: int,
    critical_build_failures: bool,
    critical_test_failures: bool,
    failed_builds: int,
    failed_tests: int,
    has_unstable_builds: bool,
    partial_errors: int,
    snapshot_stale: bool,
) -> str:
    """Return normalized incident severity: critical/high/warn/ok."""
    if services_down > 0 or critical_build_failures or critical_test_failures:
        return "critical"
    if failed_builds > 0 or failed_tests > 0 or has_unstable_builds:
        return "high"
    if partial_errors > 0 or snapshot_stale:
        return "warn"
    return "ok"
