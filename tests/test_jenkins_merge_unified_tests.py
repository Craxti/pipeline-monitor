from __future__ import annotations

from datetime import datetime, timedelta, timezone

from models.models import BuildRecord, BuildStatus, CISnapshot, TestRecord as ModelTestRecord
from web.services.collect_sync.jenkins_merge_unified_tests import merge_jenkins_unified_tests


def _build(*, job: str, bn: int, inst: str = "J1") -> BuildRecord:
    return BuildRecord(
        source="jenkins",
        source_instance=inst,
        job_name=job,
        build_number=bn,
        status=BuildStatus.FAILURE,
        started_at=datetime(2026, 4, 22, 12, 0, 0, tzinfo=timezone.utc),
        duration_seconds=120.0,
        url=f"https://j.example/job/{job}/{bn}/",
    )


def test_merge_combines_allure_and_console_same_scenario() -> None:
    snap = CISnapshot(
        builds=[_build(job="myjob", bn=10)],
        tests=[
            ModelTestRecord(
                source="jenkins_build",
                source_instance="J1",
                suite="myjob",
                test_name="myjob",
                status="failed",
                duration_seconds=99.0,
                timestamp=datetime(2026, 4, 22, 11, 0, 0, tzinfo=timezone.utc),
                build_number=10,
            ),
            ModelTestRecord(
                source="jenkins_allure",
                source_instance="J1",
                suite="myjob",
                test_name="test_login",
                status="failed",
                failure_message="from allure",
                timestamp=datetime(2026, 4, 22, 11, 30, 0, tzinfo=timezone.utc),
                build_number=10,
                allure_uid="abc-uid-1",
                allure_description="See also README",
            ),
            ModelTestRecord(
                source="jenkins_console",
                source_instance="J1",
                suite="myjob",
                test_name="tests/test_x.py::test_login",
                status="failed",
                failure_message="from console",
                timestamp=datetime(2026, 4, 22, 11, 31, 0, tzinfo=timezone.utc),
                build_number=10,
            ),
        ],
    )
    n = merge_jenkins_unified_tests(snap, TestRecord=ModelTestRecord, logger=None)
    assert n == 1
    assert len(snap.tests) == 1
    u = snap.tests[0]
    assert u.source == "jenkins_unified"
    assert u.test_name == "test_login"
    assert u.build_number == 10
    assert u.duration_seconds == 120.0
    assert u.timestamp == snap.builds[0].started_at
    assert "[Allure]" in (u.failure_message or "")
    assert "[Console]" in (u.failure_message or "")
    assert u.allure_uid == "abc-uid-1"
    assert u.allure_description == "See also README"


def test_merge_synth_only_when_no_parsers() -> None:
    snap = CISnapshot(
        builds=[_build(job="onlyjob", bn=3)],
        tests=[
            ModelTestRecord(
                source="jenkins_build",
                source_instance="J1",
                suite="onlyjob",
                test_name="onlyjob",
                status="passed",
                duration_seconds=5.0,
                timestamp=datetime(2026, 4, 22, 10, 0, 0, tzinfo=timezone.utc),
                build_number=3,
            ),
        ],
    )
    merge_jenkins_unified_tests(snap, TestRecord=ModelTestRecord, logger=None)
    assert len(snap.tests) == 1
    assert snap.tests[0].source == "jenkins_unified"
    assert snap.tests[0].test_name == "onlyjob"


def test_merge_keeps_non_jenkins_tests() -> None:
    snap = CISnapshot(
        builds=[_build(job="j", bn=1)],
        tests=[
            ModelTestRecord(source="pytest", suite="s", test_name="t", status="passed"),
            ModelTestRecord(
                source="jenkins_build",
                source_instance="J1",
                suite="j",
                test_name="j",
                status="passed",
                build_number=1,
            ),
        ],
    )
    merge_jenkins_unified_tests(snap, TestRecord=ModelTestRecord, logger=None)
    assert len(snap.tests) == 2
    kinds = {(t.source, t.test_name) for t in snap.tests}
    assert ("pytest", "t") in kinds
    assert ("jenkins_unified", "j") in kinds


def test_aggregate_top_failures_includes_allure_fields_from_latest() -> None:
    from web.services.tests_analytics import aggregate_top_failing_tests

    t0 = datetime.now(tz=timezone.utc)
    tests = [
        ModelTestRecord(
            source="jenkins_unified",
            source_instance="J1",
            suite="job/A",
            test_name="t_fail",
            status="failed",
            failure_message="x",
            timestamp=t0 - timedelta(days=1),
            build_number=40,
            allure_uid="uid-old",
        ),
        ModelTestRecord(
            source="jenkins_unified",
            source_instance="J1",
            suite="job/A",
            test_name="t_fail",
            status="failed",
            failure_message="y",
            timestamp=t0,
            build_number=41,
            allure_uid="uid-new",
            allure_description="d1",
            allure_attachments=[{"name": "s", "type": "image/png", "source": "a.png"}],
        ),
    ]
    rows = aggregate_top_failing_tests(tests, top_n=10)
    assert len(rows) == 1
    r = rows[0]
    assert r["build_number"] == 41
    assert r["allure_uid"] == "uid-new"
    assert r["allure_description"] == "d1"
    assert r["allure_attachments"] and r["allure_attachments"][0]["source"] == "a.png"


def test_filter_tests_by_source_jenkins_unified() -> None:
    from web.services.tests_analytics import filter_tests_by_source

    items = [
        ModelTestRecord(source="jenkins_unified", suite="x", test_name="a", status="failed", allure_uid="abc"),
        ModelTestRecord(
            source="jenkins_unified",
            suite="x",
            test_name="c_only",
            status="failed",
            failure_message="[Console]\nstack…",
        ),
        ModelTestRecord(source="jenkins_build", suite="y", test_name="y", status="passed"),
        ModelTestRecord(source="pytest", suite="s", test_name="t", status="passed"),
        ModelTestRecord(source="jenkins_allure", suite="z", test_name="orphan", status="failed"),
    ]
    u = filter_tests_by_source(items, "jenkins_unified")
    assert len(u) == 2 and {t.test_name for t in u} == {"a", "c_only"}
    j = filter_tests_by_source(items, "jenkins")
    assert len(j) == 2
    ja = filter_tests_by_source(items, "jenkins_allure")
    assert {t.test_name for t in ja} == {"a", "orphan"}
    jc = filter_tests_by_source(items, "jenkins_console")
    assert len(jc) == 1 and jc[0].test_name == "c_only"
    real = filter_tests_by_source(items, "real")
    assert len(real) == 4
    assert {t.test_name for t in real} == {"a", "c_only", "t", "orphan"}


def test_merge_borrows_allure_meta_for_console_row_same_norm_unmatched() -> None:
    """Console row left unmatched by fuzzy pairing still gets Allure uid if norm key is unique (Real filter UI)."""
    snap = CISnapshot(
        builds=[_build(job="job", bn=1)],
        tests=[
            ModelTestRecord(
                source="jenkins_allure",
                source_instance="J1",
                suite="job",
                test_name="scenario_x",
                status="failed",
                failure_message="from allure",
                build_number=1,
                allure_uid="uid-99",
                allure_description="d1",
            ),
            ModelTestRecord(
                source="jenkins_console",
                source_instance="J1",
                suite="job",
                test_name="№5 long wrapper mentioning scenario_x and more text",
                status="failed",
                failure_message="c1",
                build_number=1,
            ),
            ModelTestRecord(
                source="jenkins_console",
                source_instance="J1",
                suite="job",
                test_name="scenario_x",
                status="failed",
                failure_message="c2",
                build_number=1,
            ),
        ],
    )
    merge_jenkins_unified_tests(snap, TestRecord=ModelTestRecord, logger=None)
    assert len(snap.tests) == 2
    by_name = {t.test_name: t for t in snap.tests}
    assert by_name["scenario_x"].allure_uid == "uid-99"
    assert by_name["scenario_x"].allure_description == "d1"


def test_merge_borrows_allure_meta_for_console_row_fuzzy_unmatched() -> None:
    """Fallback fuzzy match also propagates Allure meta into unified console row."""
    snap = CISnapshot(
        builds=[_build(job="job", bn=2)],
        tests=[
            ModelTestRecord(
                source="jenkins_allure",
                source_instance="J1",
                suite="job",
                test_name="test_create_user",
                status="failed",
                failure_message="from allure",
                build_number=2,
                allure_uid="uid-fuzzy",
                allure_description="desc-fuzzy",
            ),
            ModelTestRecord(
                source="jenkins_console",
                source_instance="J1",
                suite="job",
                test_name="tests/api/test_users.py::test_create_user[param-1]",
                status="failed",
                failure_message="from console",
                build_number=2,
            ),
        ],
    )
    merge_jenkins_unified_tests(snap, TestRecord=ModelTestRecord, logger=None)
    assert len(snap.tests) == 1
    r = snap.tests[0]
    assert r.source == "jenkins_unified"
    assert r.allure_uid == "uid-fuzzy"
    assert r.allure_description == "desc-fuzzy"


def test_merge_unifies_folder_and_short_job_same_build() -> None:
    snap = CISnapshot(
        builds=[_build(job="folder/myjob", bn=10)],
        tests=[
            ModelTestRecord(
                source="jenkins_allure",
                source_instance="J1",
                suite="myjob",
                test_name="test_login",
                status="failed",
                failure_message="a",
                build_number=10,
            ),
            ModelTestRecord(
                source="jenkins_console",
                source_instance="J1",
                suite="folder/myjob",
                test_name="tests/x.py::test_login",
                status="failed",
                failure_message="c",
                build_number=10,
            ),
        ],
    )
    merge_jenkins_unified_tests(snap, TestRecord=ModelTestRecord, logger=None)
    assert len(snap.tests) == 1
    assert snap.tests[0].source == "jenkins_unified"
    assert snap.tests[0].suite == "folder/myjob"
