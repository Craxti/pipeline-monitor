"""
CSV report generator.

Writes one flat CSV file containing builds, tests, and service statuses.
"""

from __future__ import annotations

import csv
import logging
from pathlib import Path

from models.models import CISnapshot

logger = logging.getLogger(__name__)


class CsvReporter:
    """Export a CISnapshot to CSV."""

    # ── build columns ────────────────────────────────────────────────────────
    BUILD_FIELDS = [
        "type", "source", "job_name", "build_number", "status",
        "started_at", "duration_seconds", "branch", "commit_sha",
        "url", "critical",
    ]
    # ── test columns ─────────────────────────────────────────────────────────
    TEST_FIELDS = [
        "type", "source", "suite", "test_name", "status",
        "duration_seconds", "failure_message", "timestamp", "file_path",
    ]
    # ── service columns ──────────────────────────────────────────────────────
    SVC_FIELDS = ["type", "name", "kind", "status", "detail", "checked_at"]

    def write(self, snapshot: CISnapshot, output_path: str | Path) -> Path:
        """Write the snapshot to a single CSV file and return its path."""
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)

        all_fields = sorted(
            set(self.BUILD_FIELDS + self.TEST_FIELDS + self.SVC_FIELDS)
        )

        rows: list[dict] = []

        for b in snapshot.builds:
            row = {"type": "build"}
            row.update(b.model_dump())
            row["started_at"] = (
                b.started_at.isoformat() if b.started_at else ""
            )
            rows.append(row)

        for t in snapshot.tests:
            row = {"type": "test"}
            row.update(t.model_dump())
            row["timestamp"] = t.timestamp.isoformat() if t.timestamp else ""
            rows.append(row)

        for s in snapshot.services:
            row = {"type": "service"}
            row.update(s.model_dump())
            row["checked_at"] = s.checked_at.isoformat()
            rows.append(row)

        with out.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=all_fields, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(rows)

        logger.info("CSV report written -> %s (%d rows)", out, len(rows))
        return out
