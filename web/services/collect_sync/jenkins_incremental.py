"""Incremental Jenkins Allure/console parse — skip builds already in the DB snapshot."""

from __future__ import annotations

from typing import Any, Callable

_JENKINS_RESTORE_SOURCES = frozenset({"jenkins_allure", "jenkins_console", "jenkins_build", "jenkins_unified"})
_ALLURE_SOURCES = frozenset({"jenkins_allure", "jenkins_unified"})
_CONSOLE_SOURCES = frozenset({"jenkins_console", "jenkins_unified"})


def _norm_inst(value: Any) -> str:
    return str(value or "").strip()


def _job_from_test_row(row: Any, source: str) -> str:
    src = (getattr(row, "source", None) or "").strip().lower()
    if src == "jenkins_build":
        return (getattr(row, "suite", None) or getattr(row, "test_name", "") or "").strip()
    return (getattr(row, "suite", None) or "").strip() or (getattr(row, "test_name", "") or "").strip()


def max_parsed_build_for_job(
    prev_snapshot: Any | None,
    *,
    inst_key: str,
    job_name: str,
    kind: str,
) -> int:
    """Highest build number already present in ``prev_snapshot`` for this job/kind."""
    if prev_snapshot is None:
        return 0
    sources = _ALLURE_SOURCES if kind == "allure" else _CONSOLE_SOURCES
    job_name = (job_name or "").strip()
    if not job_name:
        return 0
    wm = 0
    for row in getattr(prev_snapshot, "tests", None) or []:
        src = (getattr(row, "source", None) or "").strip().lower()
        if src not in sources:
            continue
        if _norm_inst(getattr(row, "source_instance", None)) != _norm_inst(inst_key):
            continue
        row_job = _job_from_test_row(row, src)
        if row_job != job_name:
            try:
                from clients.jenkins_client import JenkinsClient

                if not JenkinsClient.job_names_equivalent(row_job, job_name):
                    continue
            except Exception:
                continue
        bn = getattr(row, "build_number", None)
        if bn is None:
            continue
        try:
            wm = max(wm, int(bn))
        except (TypeError, ValueError):
            continue
    return wm


def _state_key(inst_url: str, job_name: str, kind: str) -> str:
    base = str(inst_url or "").rstrip("/")
    return f"jenkins|{base}|{job_name}|{kind}_bn"


def make_build_parse_gate(
    *,
    inst_url: str,
    inst_key: str,
    kind: str,
    prev_snapshot: Any | None,
    get_collector_state_int: Callable[[str, int], int],
    set_collector_state_int: Callable[[str, int], None] | None,
    stats: dict | None = None,
    stats_key: str | None = None,
) -> tuple[Callable[[str, int], bool], Callable[[str, int], None]]:
    """Return (should_parse, mark_parsed) callbacks for Allure/console parsers."""

    def _watermark(job_name: str) -> int:
        job_name = (job_name or "").strip()
        if not job_name:
            return 0
        key = _state_key(inst_url, job_name, kind)
        wm = int(get_collector_state_int(key, 0) or 0)
        if wm <= 0:
            wm = max_parsed_build_for_job(prev_snapshot, inst_key=inst_key, job_name=job_name, kind=kind)
        return wm

    def should_parse(job_name: str, build_num: int) -> bool:
        try:
            bn = int(build_num)
        except (TypeError, ValueError):
            return True
        if bn <= _watermark(job_name):
            if stats is not None and stats_key:
                stats[stats_key] = int(stats.get(stats_key, 0) or 0) + 1
            return False
        return True

    def mark_parsed(job_name: str, build_num: int) -> None:
        if set_collector_state_int is None:
            return
        job_name = (job_name or "").strip()
        if not job_name:
            return
        try:
            bn = int(build_num)
        except (TypeError, ValueError):
            return
        key = _state_key(inst_url, job_name, kind)
        prev = int(get_collector_state_int(key, 0) or 0)
        if bn > prev:
            set_collector_state_int(key, bn)

    return should_parse, mark_parsed


def restore_prev_jenkins_tests(
    snapshot: Any,
    prev_snapshot: Any | None,
    *,
    snap_lock: Any | None = None,
) -> int:
    """Copy prior Jenkins test rows into the working snapshot (incremental collect)."""
    if prev_snapshot is None:
        return 0
    rows: list[Any] = []
    for row in getattr(prev_snapshot, "tests", None) or []:
        src = (getattr(row, "source", None) or "").strip().lower()
        if src in _JENKINS_RESTORE_SOURCES:
            rows.append(row)
    if not rows:
        return 0
    if snap_lock is not None:
        with snap_lock:
            snapshot.tests.extend(rows)
    else:
        snapshot.tests.extend(rows)
    return len(rows)
