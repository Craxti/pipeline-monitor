"""
Unit tests for report parsers.
"""
from __future__ import annotations

import textwrap
from datetime import datetime, timezone
from pathlib import Path

import pytest

from parsers.allure_failure_text import (
    failure_text_from_allure_case_dict,
    failure_text_from_allure_result_item,
    failure_text_from_status_details,
)
from parsers.jenkins_console_parser import JenkinsConsoleParser
from parsers.pytest_parser import PytestXMLParser


# ── Jenkins console parser ────────────────────────────────────────────────────

CONSOLE_SAMPLE = textwrap.dedent("""\
    Started by timer
    [Pipeline] Start of Pipeline
    [Pipeline] echo
    ====== Результаты выполнения ======
    [Pipeline] echo
    №1  Создание интеграции: ✅ Успешно
    [Pipeline] echo
    №2  Кластеризация DBSCAN: ❌ Ошибка: job_test_29 #20 completed with status UNSTABLE
    [Pipeline] echo
    №3  Проверка API: ✅ Успешно
    [Pipeline] End of Pipeline
""")

CONSOLE_NO_BLOCK = """\
    Started by timer
    [Pipeline] Start of Pipeline
    Nothing here
"""

CONSOLE_ONLY_FAILURES = textwrap.dedent("""\
    ====== Результаты выполнения ======
    №1  Тест А: ❌ Ошибка: timeout after 30s
    №2  Тест Б: ❌ Ошибка: null
""")

CONSOLE_PIPELINE_FAIL_WITH_PYTEST = textwrap.dedent("""\
    ====== Результаты выполнения ======
    [Pipeline] echo
    №27  Ручная модель кластеризации: Ошибка: test_27_clusterize_manual_agent_oim #23 completed with status UNSTABLE (propagate: false to ignore)

    FAILED tests/clusterize_ui/test_27_clusterize_manual_agent_oim.py::test_27_clusterize_manual_agent_oim - AssertionError: boom
    E   web.driver.base.ElementNotFound: Элемент: (//*[contains(text(), 'x')])[1] не найден в течение 60 сек
""")


class _FakeParser(JenkinsConsoleParser):
    """Subclass that skips actual HTTP calls."""

    def __init__(self, console_text: str, job_name: str = "fake-job") -> None:
        # Initialise with dummy credentials — no real network calls needed
        super().__init__(
            url="http://fake",
            username="u",
            token="t",
            jobs=[{"name": job_name, "parse_console": True}],
            max_builds=1,
        )
        self._console_text = console_text
        self._job_name = job_name

    def _fetch_build_numbers(self, job_name: str) -> list[int]:
        return [1]

    def _fetch_console(self, job_name: str, build_number: int) -> str:
        return self._console_text

    def _fetch_build_timing(
        self, job_name: str, build_number: int
    ) -> tuple[datetime | None, float | None]:
        # 285 s = 4m 45s — same as Jenkins duration field (ms) / 1000
        return datetime(2024, 1, 15, 12, 0, 0, tzinfo=timezone.utc), 285.0


class TestJenkinsConsoleParser:
    def test_parses_passed_and_failed(self) -> None:
        parser = _FakeParser(CONSOLE_SAMPLE, "test-job")
        records = parser.fetch_tests()
        assert len(records) == 3
        statuses = [r.status for r in records]
        assert statuses.count("passed") == 2
        assert statuses.count("failed") == 1

    def test_failed_record_has_message(self) -> None:
        parser = _FakeParser(CONSOLE_SAMPLE)
        failed = [r for r in parser.fetch_tests() if r.status == "failed"]
        assert len(failed) == 1
        assert "UNSTABLE" in (failed[0].failure_message or "")

    def test_pipeline_unstable_replaced_with_pytest_detail(self) -> None:
        parser = _FakeParser(CONSOLE_PIPELINE_FAIL_WITH_PYTEST, "Regress")
        failed = [r for r in parser.fetch_tests() if r.status == "failed"]
        assert len(failed) == 1
        msg = failed[0].failure_message or ""
        assert "ElementNotFound" in msg
        assert "не найден" in msg
        assert "UNSTABLE" not in msg

    def test_no_results_block_returns_empty(self) -> None:
        parser = _FakeParser(CONSOLE_NO_BLOCK)
        assert parser.fetch_tests() == []

    def test_suite_set_to_job_name(self) -> None:
        parser = _FakeParser(CONSOLE_SAMPLE, "my-pipeline")
        for r in parser.fetch_tests():
            assert r.suite == "my-pipeline"

    def test_source_is_jenkins_console(self) -> None:
        parser = _FakeParser(CONSOLE_SAMPLE)
        for r in parser.fetch_tests():
            assert r.source == "jenkins_console"

    def test_console_records_have_no_build_wide_duration(self) -> None:
        """Per-scenario console rows must not reuse whole-pipeline duration (misleading)."""
        parser = _FakeParser(CONSOLE_SAMPLE)
        for r in parser.fetch_tests():
            assert r.duration_seconds is None

    def test_records_use_build_timestamp_not_parse_time(self) -> None:
        parser = _FakeParser(CONSOLE_SAMPLE)
        for r in parser.fetch_tests():
            assert r.timestamp == datetime(2024, 1, 15, 12, 0, 0, tzinfo=timezone.utc)

    def test_null_failure_message_kept_raw(self) -> None:
        """Parser records 'null' literally; filtering happens in the API layer."""
        parser = _FakeParser(CONSOLE_ONLY_FAILURES)
        records = parser.fetch_tests()
        assert len(records) == 2
        msgs = [r.failure_message for r in records]
        assert any("null" in (m or "") for m in msgs)

    def test_job_with_parse_console_false_skipped(self) -> None:
        parser = JenkinsConsoleParser(
            url="http://fake",
            username="u",
            token="t",
            jobs=[{"name": "no-parse", "parse_console": False}],
            max_builds=1,
        )
        assert parser.fetch_tests() == []


# ── PytestXMLParser ───────────────────────────────────────────────────────────

JUNIT_XML = textwrap.dedent("""\
    <?xml version="1.0" encoding="utf-8"?>
    <testsuites>
      <testsuite name="suite_a" timestamp="2024-01-15T10:00:00">
        <testcase classname="suite_a" name="test_pass" time="0.5"/>
        <testcase classname="suite_a" name="test_fail" time="1.2">
          <failure message="AssertionError">assert 1 == 2</failure>
        </testcase>
        <testcase classname="suite_a" name="test_skip" time="0.0">
          <skipped message="not ready"/>
        </testcase>
        <testcase classname="suite_a" name="test_err" time="0.1">
          <error message="RuntimeError">boom</error>
        </testcase>
      </testsuite>
    </testsuites>
""")

BARE_SUITE_XML = textwrap.dedent("""\
    <?xml version="1.0"?>
    <testsuite name="bare">
      <testcase name="only_one" time="0.1"/>
    </testsuite>
""")

MALFORMED_XML = "not xml at all <<<"


class TestPytestXMLParser:
    def _parse_text(self, xml: str, tmp_path: Path) -> list:
        f = tmp_path / "report.xml"
        f.write_text(xml, encoding="utf-8")
        return PytestXMLParser().parse_file(f)

    def test_parses_all_statuses(self, tmp_path: Path) -> None:
        records = self._parse_text(JUNIT_XML, tmp_path)
        statuses = {r.test_name: r.status for r in records}
        assert statuses["test_pass"] == "passed"
        assert statuses["test_fail"] == "failed"
        assert statuses["test_skip"] == "skipped"
        assert statuses["test_err"] == "error"

    def test_failure_message_captured(self, tmp_path: Path) -> None:
        records = self._parse_text(JUNIT_XML, tmp_path)
        fail = next(r for r in records if r.test_name == "test_fail")
        assert "AssertionError" in (fail.failure_message or "")

    def test_duration_parsed(self, tmp_path: Path) -> None:
        records = self._parse_text(JUNIT_XML, tmp_path)
        passed = next(r for r in records if r.test_name == "test_pass")
        assert passed.duration_seconds == pytest.approx(0.5)

    def test_bare_testsuite_root(self, tmp_path: Path) -> None:
        records = self._parse_text(BARE_SUITE_XML, tmp_path)
        assert len(records) == 1
        assert records[0].test_name == "only_one"
        assert records[0].status == "passed"

    def test_malformed_xml_returns_empty(self, tmp_path: Path) -> None:
        records = self._parse_text(MALFORMED_XML, tmp_path)
        assert records == []

    def test_source_is_pytest(self, tmp_path: Path) -> None:
        records = self._parse_text(JUNIT_XML, tmp_path)
        for r in records:
            assert r.source == "pytest"

    def test_glob_pattern_is_xml(self) -> None:
        assert PytestXMLParser().glob_pattern == "*.xml"


# ── Allure failure text helpers ───────────────────────────────────────────────

class TestAllureFailureText:
    def test_status_details_nested_dict(self) -> None:
        sd = {"message": {"reason": "boom"}, "trace": "line1\nline2"}
        text = failure_text_from_status_details(sd, max_len=500)
        assert "boom" in text

    def test_case_dict_falls_back_to_status_message(self) -> None:
        case = {"statusMessage": "requests.exceptions.ConnectTimeout: x"}
        assert "ConnectTimeout" in failure_text_from_allure_case_dict(case)

    def test_case_dict_reads_nested_step_failure(self) -> None:
        case = {
            "status": "failed",
            "statusDetails": {},
            "steps": [
                {"name": "Outer", "status": "passed", "steps": []},
                {
                    "name": "Шаг 9. Создание модели",
                    "status": "failed",
                    "statusDetails": {"message": "ElementNotFound: элемент не найден"},
                },
            ],
        }
        text = failure_text_from_allure_case_dict(case)
        assert "ElementNotFound" in text
        assert "Шаг 9" in text

    def test_result_item_merges_root_and_steps(self) -> None:
        item = {
            "name": "t",
            "status": "failed",
            "statusDetails": {},
            "steps": [
                {
                    "name": "POST events",
                    "status": "broken",
                    "statusDetails": {"message": "requests.exceptions.ConnectTimeout: timed out"},
                }
            ],
        }
        assert "ConnectTimeout" in failure_text_from_allure_result_item(item)
