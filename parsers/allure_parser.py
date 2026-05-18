"""
Parser for Allure JSON result files (allure-results/*.json).

Each file corresponds to a single test case.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from models.models import TestRecord
from parsers.allure_failure_text import failure_text_from_allure_result_item

from .base import BaseParser

logger = logging.getLogger(__name__)

_STATUS_MAP = {
    "passed": "passed",
    "failed": "failed",
    "broken": "error",
    "skipped": "skipped",
    "pending": "skipped",
    "unknown": "skipped",
}


class AllureJsonParser(BaseParser):
    """Parse Allure JSON result files."""

    @property
    def glob_pattern(self) -> str:
        return "*-result.json"

    def parse_file(self, path: Path) -> list[TestRecord]:
        try:
            with path.open(encoding="utf-8") as fh:
                data = json.load(fh)
        except (json.JSONDecodeError, OSError) as exc:
            logger.error("Cannot read %s: %s", path, exc)
            return []

        # Allure might store a list or a single object
        items = data if isinstance(data, list) else [data]
        records: list[TestRecord] = []

        for item in items:
            name = item.get("name") or item.get("fullName") or "unknown"
            suite = _extract_suite(item)
            raw_status = item.get("status", "unknown")
            status = _STATUS_MAP.get(raw_status, "unknown")

            start_ms = item.get("start")
            stop_ms = item.get("stop")
            ts: datetime | None = None
            duration: float | None = None
            if start_ms:
                ts = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc)
            if start_ms and stop_ms:
                duration = (stop_ms - start_ms) / 1000

            message: str | None = None
            extracted = failure_text_from_allure_result_item(item, max_len=8000).strip()
            if extracted:
                message = extracted[:4000]

            records.append(
                TestRecord(
                    source="allure",
                    suite=suite,
                    test_name=name,
                    status=status,
                    duration_seconds=duration,
                    failure_message=message,
                    timestamp=ts,
                    file_path=str(path),
                )
            )

        logger.debug("AllureJsonParser: %d records from %s", len(records), path)
        return records


def _extract_suite(item: dict) -> str | None:
    """Pull suite name from labels list."""
    for label in item.get("labels", []):
        if label.get("name") in ("suite", "parentSuite", "feature"):
            return label.get("value")
    return item.get("fullName", "").split("#")[0] or None
