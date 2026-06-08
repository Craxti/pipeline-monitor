from __future__ import annotations

import tempfile
from datetime import datetime, timedelta, timezone

import pytest

from models.models import BuildRecord, BuildStatus, CISnapshot, ServiceStatus, TestRecord
from web import db as dbmod


@pytest.fixture()
def isolated_db():
    """
    Create an isolated SQLite DB in a temporary directory and restore the global
    db module state afterwards (dbmod uses a module-level _DB_PATH).
    """
    old_path = dbmod._DB_PATH
    try:
        with tempfile.TemporaryDirectory() as td:
            dbmod.init_db(td)
            yield
    finally:
        dbmod._DB_PATH = old_path
        if old_path is not None:
            dbmod.init_db(old_path.parent)


class TestCollectorState:
    def test_set_and_get_int_roundtrip(self, isolated_db) -> None:
        dbmod.set_collector_state_int("k1", 123)
        assert dbmod.get_collector_state_int("k1") == 123

    def test_get_missing_returns_default(self, isolated_db) -> None:
        assert dbmod.get_collector_state_int("missing", default=7) == 7


class TestBuildDurationHistory:
    def test_returns_oldest_first(self, isolated_db) -> None:
        now = datetime.now(tz=timezone.utc)
        snap = CISnapshot(
            collected_at=now,
            builds=[
                BuildRecord(
                    source="jenkins",
                    job_name="job-x",
                    build_number=1,
                    status=BuildStatus.SUCCESS,
                    started_at=now - timedelta(hours=2),
                    duration_seconds=10.0,
                ),
                BuildRecord(
                    source="jenkins",
                    job_name="job-x",
                    build_number=2,
                    status=BuildStatus.FAILURE,
                    started_at=now - timedelta(hours=1),
                    duration_seconds=12.0,
                ),
            ],
        )
        dbmod.append_snapshot(snap)

        items = dbmod.build_duration_history("job-x", limit=20)
        assert [it["n"] for it in items] == [1, 2]
        assert items[0]["s"] in ("success", "failure")


class TestFlakyAnalysis:
    def test_detects_flips(self, isolated_db) -> None:
        now = datetime.now(tz=timezone.utc)
        # Append multiple snapshots to create alternating statuses
        for i, st in enumerate(
            [BuildStatus.SUCCESS, BuildStatus.FAILURE, BuildStatus.SUCCESS, BuildStatus.FAILURE],
            start=1,
        ):
            dbmod.append_snapshot(
                CISnapshot(
                    collected_at=now + timedelta(minutes=i),
                    builds=[
                        BuildRecord(
                            source="jenkins",
                            job_name="job-flaky",
                            build_number=i,
                            status=st,
                            started_at=now + timedelta(minutes=i),
                        )
                    ],
                )
            )

        flaky = dbmod.flaky_analysis(threshold=0.4, min_runs=4, days=30)
        assert any(x["job"] == "job-flaky" for x in flaky)


class TestTestsHistoryAllureMeta:
    def test_persists_and_reads_allure_fields(self, isolated_db, monkeypatch) -> None:
        # load_yaml_config() re-opens the production DB during retention cleanup — keep isolated path.
        monkeypatch.setattr(dbmod, "_run_retention_cleanup_if_due", lambda: None)
        now = datetime.now(tz=timezone.utc)
        snap = CISnapshot(
            collected_at=now,
            tests=[
                TestRecord(
                    source="jenkins_unified",
                    source_instance="Jenkins ARTIMATE",
                    suite="job/ui-tests",
                    test_name="test_login",
                    status="failed",
                    failure_message="assert 1 == 2",
                    timestamp=now,
                    build_number=99,
                    allure_uid="uid-abc",
                    allure_description="Steps to reproduce",
                    allure_attachments=[
                        {"name": "shot.png", "type": "image/png", "source": "attachments/shot.png"},
                    ],
                ),
            ],
        )
        dbmod.append_snapshot(snap)

        data = dbmod.query_tests_history(name="test_login", page=1, per_page=10)
        assert data["total"] == 1
        item = data["items"][0]
        assert item["source_instance"] == "Jenkins ARTIMATE"
        assert item["build_number"] == 99
        assert item["allure_uid"] == "uid-abc"
        assert item["allure_description"] == "Steps to reproduce"
        assert item["allure_attachments"] and item["allure_attachments"][0]["source"] == "attachments/shot.png"


class TestServiceUptime:
    def test_uptime_groups_by_service_and_day(self, isolated_db) -> None:
        now = datetime.now(tz=timezone.utc)
        snap = CISnapshot(
            collected_at=now,
            services=[
                ServiceStatus(
                    name="svc-a",
                    kind="http",
                    status="up",
                    detail="ok",
                    checked_at=now,
                ),
                ServiceStatus(
                    name="svc-a",
                    kind="http",
                    status="down",
                    detail="bad",
                    checked_at=now + timedelta(days=1),
                ),
            ],
        )
        dbmod.append_snapshot(snap)

        out = dbmod.service_uptime(days=30)
        assert "svc-a" in out
        assert isinstance(out["svc-a"], list)
        assert all("date" in row and "status" in row for row in out["svc-a"])
