from __future__ import annotations

from datetime import datetime, timezone

from models.models import TestRecord as ModelTestRecord
from web.services.tests_endpoints import _enrich_test_records_from_snapshot, _history_test_records


def test_history_rows_enriched_when_source_differs() -> None:
    snap = ModelTestRecord(
        source="jenkins_unified",
        source_instance="Jenkins ARTIMATE",
        suite="job/ui",
        test_name="test_a",
        status="failed",
        build_number=12,
        allure_uid="uid-live",
        allure_description="desc-live",
        timestamp=datetime.now(tz=timezone.utc),
    )
    hist_rows = [
        {
            "source": "jenkins_allure",
            "suite": "job/ui",
            "test_name": "test_a",
            "status": "failed",
            "failure_message": "boom",
            "timestamp": snap.timestamp.isoformat(),
        }
    ]
    records = _enrich_test_records_from_snapshot(_history_test_records(hist_rows), [snap])
    r = records[0]
    assert r.allure_uid == "uid-live"
    assert r.build_number == 12


def test_history_rows_enriched_from_snapshot_when_allure_missing() -> None:
    snap = ModelTestRecord(
        source="jenkins_unified",
        source_instance="Jenkins ARTIMATE",
        suite="job/ui",
        test_name="test_a",
        status="failed",
        build_number=12,
        allure_uid="uid-live",
        allure_description="desc-live",
        allure_attachments=[{"name": "s.png", "type": "image/png", "source": "a.png"}],
        timestamp=datetime.now(tz=timezone.utc),
    )
    hist_rows = [
        {
            "source": "jenkins_unified",
            "suite": "job/ui",
            "test_name": "test_a",
            "status": "failed",
            "failure_message": "boom",
            "timestamp": snap.timestamp.isoformat(),
        }
    ]
    records = _enrich_test_records_from_snapshot(_history_test_records(hist_rows), [snap])
    assert len(records) == 1
    r = records[0]
    assert r.build_number == 12
    assert r.allure_uid == "uid-live"
    assert r.allure_description == "desc-live"
    assert r.allure_attachments and r.allure_attachments[0]["source"] == "a.png"
