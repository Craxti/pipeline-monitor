"""Prometheus Alertmanager adapter."""

from __future__ import annotations

from models.models import ServiceStatus
from service_monitors.base import clean_url, inst_label, join_url, make_service, map_status, request_json


def _headers(inst: dict) -> dict[str, str]:
    token = str(inst.get("token") or inst.get("bearer_token") or "").strip()
    if not token:
        return {}
    return {"Authorization": f"Bearer {token}"}


def collect_alertmanager(inst: dict, *, timeout: int) -> list[ServiceStatus]:
    label = inst_label(inst)
    kind = "alertmanager"
    base = clean_url(inst.get("url"))
    url = join_url(base, str(inst.get("alerts_path") or "/api/v2/alerts"))
    data = request_json(
        method="GET",
        url=url,
        headers=_headers(inst),
        timeout=timeout,
        verify_ssl=inst.get("verify_ssl", True) is not False,
    )
    rows = data if isinstance(data, list) else []
    items: list[ServiceStatus] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        labels = row.get("labels") if isinstance(row.get("labels"), dict) else {}
        name = str(labels.get("alertname") or labels.get("instance") or "alert").strip()
        instance = str(labels.get("instance") or "").strip()
        if instance and instance not in name:
            name = f"{name} ({instance})"
        status_raw = row.get("status") or row.get("state") or "active"
        if isinstance(status_raw, dict):
            state = str(status_raw.get("state") or status_raw.get("status") or "active").strip().lower()
        else:
            state = str(status_raw).strip().lower()
        ann = row.get("annotations") if isinstance(row.get("annotations"), dict) else {}
        detail = str(ann.get("summary") or ann.get("description") or state).strip()
        items.append(
            make_service(
                name=name,
                kind=kind,
                status=map_status(state),
                detail=detail,
                source_instance=label,
            )
        )
    if not items:
        items.append(
            make_service(
                name=f"{label}: no active alerts",
                kind=kind,
                status="up",
                detail="Alertmanager returned empty",
                source_instance=label,
            )
        )
    return items


def test_alertmanager(inst: dict) -> dict:
    try:
        base = clean_url(inst.get("url"))
        url = join_url(base, "/api/v2/status")
        data = request_json(
            method="GET",
            url=url,
            headers=_headers(inst),
            timeout=10,
            verify_ssl=inst.get("verify_ssl", True) is not False,
        )
        cluster = str(((data or {}).get("cluster") or {}).get("status") or "ok")
        return {"ok": True, "message": f"Alertmanager connected. Cluster: {cluster}."}
    except Exception as exc:
        return {"ok": False, "message": f"Alertmanager connection failed: {exc}"}
