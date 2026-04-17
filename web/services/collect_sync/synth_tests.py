from __future__ import annotations

from typing import Any


def append_synthetic_tests_from_builds(
    *,
    snapshot,
    builds: list[Any],
    inst_key: str,
    TestRecord,
) -> None:
    try:
        for b in builds:
            st = b.status_normalized
            if st not in ("success", "failure", "unstable", "aborted"):
                continue
            t_status = (
                "passed"
                if st == "success"
                else "failed"
                if st in ("failure", "unstable")
                else "skipped"
            )
            snapshot.tests.append(
                TestRecord(
                    source="jenkins_build",
                    source_instance=getattr(b, "source_instance", None) or inst_key,
                    suite=b.job_name,
                    test_name=b.job_name,
                    status=t_status,
                    duration_seconds=b.duration_seconds,
                    failure_message=None,
                    timestamp=b.started_at,
                )
            )
    except Exception:
        pass

