"""Persist and query service-analysis incidents (graph-backed RCA)."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _json_dump(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def insert_service_incident(row: dict[str, Any]) -> int:
    from web import db

    return db.insert_service_incident(row)


def update_service_incident(incident_id: int, **fields: Any) -> None:
    from web import db

    db.update_service_incident(incident_id, **fields)


def list_service_incidents(*, status: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    from web import db

    return db.list_service_incidents(status=status, limit=limit)


def get_service_incident(incident_id: int) -> dict[str, Any] | None:
    from web import db

    return db.get_service_incident(incident_id)


def find_open_incident(service_key: str) -> dict[str, Any] | None:
    from web import db

    return db.find_open_service_incident(service_key)


def open_incident_from_anomaly(
    *,
    model,
    anomaly,
) -> dict[str, Any] | None:
    """Create incident with graph snapshot when a new anomaly is detected."""
    existing = find_open_incident(model.key)
    if existing:
        update_service_incident(
            int(existing["id"]),
            updated_at=_now_iso(),
            detail=str(anomaly.detail or existing.get("detail") or "")[:2000],
        )
        return existing

    detail = model.detail_payload()
    corr = detail.get("correlation") or {}
    nodes = corr.get("nodes") or []
    root_ids = [str(n.get("id")) for n in nodes if isinstance(n, dict) and n.get("role") == "root"]
    graph_snapshot = {
        "correlation": corr,
        "clusters": (detail.get("clusters") or [])[:40],
        "recent_events": (detail.get("recent_events") or [])[-30:],
        "pipeline": detail.get("pipeline"),
    }
    row = {
        "service_key": model.key,
        "service_name": model.container,
        "service_kind": model.service_kind,
        "source_instance": model.docker_host,
        "status": "open",
        "severity": str(anomaly.severity or "warn"),
        "title": str(anomaly.title or "Service anomaly"),
        "detail": str(anomaly.detail or "")[:2000],
        "anomaly_kind": str(anomaly.kind or ""),
        "template_id": str(anomaly.template_id or ""),
        "graph_json": _json_dump(graph_snapshot),
        "root_nodes_json": _json_dump(root_ids),
        "opened_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    iid = insert_service_incident(row)
    row["id"] = iid
    return row


def resolve_incidents_for_service(service_key: str, *, reason: str = "Service recovered") -> list[int]:
    """Close open incidents for a service when it returns to healthy state."""
    open_row = find_open_incident(service_key)
    if not open_row:
        return []
    iid = int(open_row["id"])
    now = _now_iso()
    update_service_incident(
        iid,
        status="resolved",
        resolved_at=now,
        updated_at=now,
        detail=f"{open_row.get('detail') or ''}\n\nResolved: {reason}".strip()[:4000],
    )
    return [iid]
