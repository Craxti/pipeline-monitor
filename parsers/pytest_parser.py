"""
Parser for pytest JUnit-XML reports (--junitxml flag).

Supports standard xunit/junit XML produced by pytest, Maven Surefire, etc.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

from models.models import TestRecord
from .base import BaseParser

logger = logging.getLogger(__name__)


class PytestXMLParser(BaseParser):
    """Parse JUnit/pytest XML test reports."""

    @property
    def glob_pattern(self) -> str:
        return "*.xml"

    def parse_file(self, path: Path) -> list[TestRecord]:
        records: list[TestRecord] = []
        try:
            tree = ET.parse(path)
        except ET.ParseError as exc:
            logger.error("XML parse error in %s: %s", path, exc)
            return records

        root = tree.getroot()
        # Handle both <testsuites><testsuite> and bare <testsuite>
        suites = root.findall("testsuite") if root.tag == "testsuites" else [root]

        for suite in suites:
            suite_name = suite.get("name", "")
            ts_str = suite.get("timestamp")
            suite_ts: datetime | None = None
            if ts_str:
                try:
                    suite_ts = datetime.fromisoformat(ts_str).replace(tzinfo=timezone.utc)
                except ValueError:
                    pass

            for tc in suite.findall("testcase"):
                name = tc.get("name", "unknown")
                classname = tc.get("classname", suite_name)
                duration = _safe_float(tc.get("time"))

                failure = tc.find("failure")
                error = tc.find("error")
                skipped = tc.find("skipped")

                if failure is not None:
                    status = "failed"
                    message = failure.get("message") or failure.text or ""
                elif error is not None:
                    status = "error"
                    message = error.get("message") or error.text or ""
                elif skipped is not None:
                    status = "skipped"
                    message = skipped.get("message") or ""
                else:
                    status = "passed"
                    message = None

                records.append(
                    TestRecord(
                        source="pytest",
                        suite=classname or suite_name,
                        test_name=name,
                        status=status,
                        duration_seconds=duration,
                        failure_message=message if message else None,
                        timestamp=suite_ts,
                        file_path=str(path),
                    )
                )

        logger.debug("PytestXMLParser: %d records from %s", len(records), path)
        return records


def _safe_float(value: str | None) -> float | None:
    try:
        return float(value) if value is not None else None
    except ValueError:
        return None
