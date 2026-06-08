from __future__ import annotations

from models.models import CISnapshot, TestRecord
from web.services.collect_sync import jenkins_incremental as ji


def test_max_parsed_build_for_job_from_prev_snapshot() -> None:
    prev = CISnapshot(
        tests=[
            TestRecord(
                source="jenkins_allure",
                source_instance="Jenkins DIT",
                suite="job/a",
                test_name="t1",
                status="passed",
                build_number=120,
            ),
            TestRecord(
                source="jenkins_allure",
                source_instance="Jenkins DIT",
                suite="job/a",
                test_name="t2",
                status="failed",
                build_number=122,
            ),
        ]
    )
    assert ji.max_parsed_build_for_job(prev, inst_key="Jenkins DIT", job_name="job/a", kind="allure") == 122


def test_build_parse_gate_skips_known_builds() -> None:
    prev = CISnapshot(
        tests=[
            TestRecord(
                source="jenkins_console",
                source_instance="inst1",
                suite="my_job",
                test_name="x",
                status="passed",
                build_number=50,
            ),
        ]
    )
    state: dict[str, int] = {}

    def get_key(key: str, default: int = 0) -> int:
        return state.get(key, default)

    def set_key(key: str, value: int) -> None:
        state[key] = value

    stats: dict[str, int] = {}
    should, mark = ji.make_build_parse_gate(
        inst_url="https://jenkins.example",
        inst_key="inst1",
        kind="console",
        prev_snapshot=prev,
        get_collector_state_int=get_key,
        set_collector_state_int=set_key,
        stats=stats,
        stats_key="jenkins_console_builds_skipped",
    )
    assert should("my_job", 50) is False
    assert should("my_job", 51) is True
    assert stats["jenkins_console_builds_skipped"] == 1
    mark("my_job", 51)
    assert should("my_job", 51) is False


def test_restore_prev_jenkins_tests() -> None:
    prev = CISnapshot(
        tests=[
            TestRecord(source="jenkins_unified", suite="j", test_name="t", status="passed"),
            TestRecord(source="gitlab", suite="g", test_name="t", status="passed"),
        ]
    )
    snap = CISnapshot(tests=[])
    n = ji.restore_prev_jenkins_tests(snap, prev)
    assert n == 1
    assert len(snap.tests) == 1
    assert snap.tests[0].source == "jenkins_unified"
