from __future__ import annotations

from models.models import BuildRecord, CISnapshot
from web.core.notifications import detect_state_changes


def _snapshot_with_build(*, job: str, status: str) -> CISnapshot:
    return CISnapshot(
        builds=[
            BuildRecord(
                source="jenkins",
                job_name=job,
                status=status,
                url=f"http://ci/job/{job}/1",
                critical=False,
            )
        ],
        tests=[],
        services=[],
    )


def test_duplicate_build_failure_is_grouped_instead_of_appended() -> None:
    notifications = [
        {
            "id": 1,
            "ts": "2026-01-01T00:00:00+00:00",
            "kind": "build_fail",
            "level": "error",
            "title": "Job FAILED: api-tests",
            "detail": "Status changed success → failure",
            "url": "http://ci/job/api-tests/1",
            "critical": False,
        }
    ]
    persisted: list[dict] = []
    snap = _snapshot_with_build(job="api-tests", status="failure")

    detect_state_changes(
        snap,
        prev_build_statuses={"api-tests": "success"},
        prev_svc_statuses={},
        prev_incident_active=True,
        prev_incident_sig=(1, 0, 0, False),
        notify_id_seq=1,
        notifications=notifications,
        notify_max=200,
        append_event=lambda entries: persisted.extend(entries),
    )

    assert len(notifications) == 1
    assert notifications[0]["repeat_count"] == 2
    assert notifications[0]["title"] == "Job FAILED: api-tests (x2)"
    # Duplicate event should not be persisted again.
    assert persisted == []


def test_non_duplicate_event_is_appended_and_persisted() -> None:
    notifications: list[dict] = []
    persisted: list[dict] = []
    snap = _snapshot_with_build(job="web-e2e", status="failure")

    detect_state_changes(
        snap,
        prev_build_statuses={"web-e2e": "success"},
        prev_svc_statuses={},
        prev_incident_active=False,
        prev_incident_sig=(0, 0, 0, False),
        notify_id_seq=0,
        notifications=notifications,
        notify_max=200,
        append_event=lambda entries: persisted.extend(entries),
    )

    assert len(notifications) >= 1
    first = notifications[0]
    assert first["kind"] == "build_fail"
    assert "repeat_count" not in first
    assert len(persisted) >= 1
    assert persisted[0]["kind"] == "build_fail"
