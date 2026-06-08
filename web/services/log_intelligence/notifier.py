"""Push service-analysis anomalies into incidents and notification feed."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from web.services.log_intelligence.container_model import AnomalyRecord
from web.services.log_intelligence import incident_store


def emit_anomaly_notifications(
    *,
    anomalies: list[AnomalyRecord],
    model,
    notify_append: Callable[[list[dict[str, Any]]], None] | None,
    notify_id_seq: int,
) -> int:
    """Open service incidents and append notification events."""
    if not anomalies or notify_append is None:
        return notify_id_seq
    now_iso = datetime.now(tz=timezone.utc).isoformat()
    batch: list[dict[str, Any]] = []
    for a in anomalies:
        existing = incident_store.find_open_incident(model.key)
        inc = incident_store.open_incident_from_anomaly(model=model, anomaly=a)
        if not inc or existing:
            continue
        notify_id_seq += 1
        level = "error" if a.severity == "critical" else "warn"
        svc = model.container
        batch.append(
            {
                "id": notify_id_seq,
                "ts": now_iso,
                "kind": "service_incident",
                "level": level,
                "title": a.title or f"Service incident: {svc}",
                "detail": f"{svc} ({model.service_kind}): {a.detail}"[:500],
                "critical": a.severity == "critical",
                "url": f"/?tab=incidents&incident={inc.get('id')}",
                "source_instance": model.docker_host,
            }
        )
    if batch:
        notify_append(batch)
    return notify_id_seq


def emit_incident_resolved(
    *,
    incident_ids: list[int],
    service_name: str,
    service_kind: str,
    notify_append: Callable[[list[dict[str, Any]]], None] | None,
    notify_id_seq: int,
) -> int:
    if not incident_ids or notify_append is None:
        return notify_id_seq
    now_iso = datetime.now(tz=timezone.utc).isoformat()
    for iid in incident_ids:
        notify_id_seq += 1
        batch = [
            {
                "id": notify_id_seq,
                "ts": now_iso,
                "kind": "service_incident_resolved",
                "level": "ok",
                "title": f"Incident resolved: {service_name}",
                "detail": f"{service_kind} service returned to healthy state",
                "url": f"/?tab=incidents&incident={iid}",
            }
        ]
        notify_append(batch)
    return notify_id_seq
