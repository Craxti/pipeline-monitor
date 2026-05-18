"""Build incident ticket / chat bundle (JSON + Markdown) from a snapshot."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Optional

from models.models import CISnapshot

from web.schemas import (
    IncidentBundlePayload,
    IncidentFailedBuildRow,
    IncidentServiceDownRow,
    IncidentSummaryBlock,
    IncidentTopFailedTestRow,
)


def _status_str(b: object) -> str:
    if isinstance(b, str):
        return b
    return getattr(b, "value", str(b))


def build_incident_bundle(snap: Optional[CISnapshot]) -> tuple[IncidentBundlePayload, str]:
    """Return typed payload and Markdown text."""
    if not snap:
        now = datetime.now(tz=timezone.utc).isoformat()
        payload = IncidentBundlePayload(
            generated_at_utc=now,
            snapshot_collected_at_utc=None,
            summary=IncidentSummaryBlock(
                failed_builds=0,
                failed_tests_in_snapshot=0,
                services_down=0,
            ),
            failed_builds=[],
            top_failed_tests=[],
            services_down=[],
            note="no_snapshot_yet",
        )
        md = "\n".join(
            [
                "# CI/CD Monitor incident snapshot",
                "",
                "_No snapshot loaded yet — run Collect or `ci_monitor.py collect`._",
                "",
                f"- Generated (UTC): `{now}`",
            ]
        )
        return payload, md

    failed_builds = [
        IncidentFailedBuildRow(
            source=b.source,
            job_name=b.job_name,
            build_number=b.build_number,
            status=_status_str(b.status),
            branch=b.branch,
            started_at=b.started_at.isoformat() if b.started_at else None,
            url=b.url,
            critical=b.critical,
        )
        for b in snap.builds
        if b.status_normalized in ("failure", "unstable")
    ]

    counter: Counter[str] = Counter()
    for t in snap.tests:
        if t.status_normalized in ("failed", "error"):
            counter[t.test_name] += 1
    top_tests = [IncidentTopFailedTestRow(test_name=name, count=cnt) for name, cnt in counter.most_common(25)]

    down_svcs = [
        IncidentServiceDownRow(name=s.name, kind=s.kind, status=s.status, detail=s.detail)
        for s in snap.services
        if s.status_normalized == "down"
    ]

    ca = snap.collected_at
    if ca.tzinfo is None:
        ca = ca.replace(tzinfo=timezone.utc)
    else:
        ca = ca.astimezone(timezone.utc)

    failed_test_count = sum(1 for t in snap.tests if t.status_normalized in ("failed", "error"))

    payload = IncidentBundlePayload(
        generated_at_utc=datetime.now(tz=timezone.utc).isoformat(),
        snapshot_collected_at_utc=ca.isoformat(),
        summary=IncidentSummaryBlock(
            failed_builds=len(failed_builds),
            failed_tests_in_snapshot=failed_test_count,
            services_down=len(down_svcs),
        ),
        failed_builds=failed_builds,
        top_failed_tests=top_tests,
        services_down=down_svcs,
    )

    lines = [
        "# CI/CD Monitor incident snapshot",
        "",
        f"- Generated (UTC): `{payload.generated_at_utc}`",
        f"- Snapshot collected (UTC): `{payload.snapshot_collected_at_utc}`",
        "",
        "## Summary",
        "",
        f"- Failed builds: **{payload.summary.failed_builds}**",
        f"- Failed test records in snapshot: **{payload.summary.failed_tests_in_snapshot}**",
        f"- Services down: **{payload.summary.services_down}**",
        "",
        "## Failed builds",
        "",
    ]
    for b in failed_builds[:50]:
        u = b.url or ""
        lines.append(
            f"- `{b.source}` **{b.job_name}** #{b.build_number} — {b.status}" + (f" — [{u}]({u})" if u else "")
        )
    lines.extend(["", "## Top failing tests (aggregated)", ""])
    for t in top_tests[:25]:
        lines.append(f"- `{t.test_name}` — {t.count}×")
    if down_svcs:
        lines.extend(["", "## Services down", ""])
        for s in down_svcs:
            lines.append(f"- `{s.name}` ({s.kind}) — {s.detail or s.status}")
    return payload, "\n".join(lines)
