"""Push log-intelligence anomalies into the dashboard notification feed."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from web.services.log_intelligence.container_model import AnomalyRecord


def emit_anomaly_notifications(
    *,
    anomalies: list[AnomalyRecord],
    container: str,
    notify_append: Callable[[list[dict[str, Any]]], None] | None,
    notify_id_seq: int,
) -> int:
    """Append notification events for anomalies; return updated id seq."""
    if not anomalies or notify_append is None:
        return notify_id_seq
    now_iso = datetime.now(tz=timezone.utc).isoformat()
    batch: list[dict[str, Any]] = []
    for a in anomalies:
        notify_id_seq += 1
        level = "error" if a.severity == "critical" else "warn"
        batch.append(
            {
                "id": notify_id_seq,
                "ts": now_iso,
                "kind": "log_anomaly",
                "level": level,
                "title": a.title,
                "detail": f"{container}: {a.detail}"[:500],
                "critical": a.severity == "critical",
            }
        )
    if batch:
        notify_append(batch)
    return notify_id_seq
