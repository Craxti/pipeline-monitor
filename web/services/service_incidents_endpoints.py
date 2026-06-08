"""API handlers for service-analysis incidents."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from web.services.log_intelligence import incident_store


def api_list_incidents(*, status: str = "", limit: int = 100) -> dict[str, Any]:
    st = str(status or "").strip().lower() or None
    if st and st not in ("open", "resolved"):
        st = None
    items = incident_store.list_service_incidents(status=st, limit=limit)
    return {"ok": True, "items": items, "total": len(items)}


def api_get_incident(incident_id: int) -> dict[str, Any]:
    row = incident_store.get_service_incident(incident_id)
    if not row:
        raise HTTPException(404, "Incident not found")
    row["ok"] = True
    return row
