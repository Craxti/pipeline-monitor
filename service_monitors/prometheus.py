"""Prometheus alerting adapter."""

from __future__ import annotations

from models.models import ServiceStatus
from service_monitors.base import clean_url, inst_label, join_url, make_service, map_status, request_json


def _headers(inst: dict) -> dict[str, str]:
    token = str(inst.get("token") or inst.get("bearer_token") or "").strip()
    if not token:
        return {}
    return {"Authorization": f"Bearer {token}"}


def collect_prometheus(inst: dict, *, timeout: int) -> list[ServiceStatus]:
    label = inst_label(inst)
    kind = "prometheus"
    base = clean_url(inst.get("url"))
    url = join_url(base, str(inst.get("alerts_path") or "/api/v1/alerts"))
    data = request_json(
        method="GET",
        url=url,
        headers=_headers(inst),
        timeout=timeout,
        verify_ssl=inst.get("verify_ssl", True) is not False,
    )
    alerts = ((data or {}).get("data") or {}).get("alerts") or []
    items: list[ServiceStatus] = []
    for alert in alerts:
        if not isinstance(alert, dict):
            continue
        labels = alert.get("labels") if isinstance(alert.get("labels"), dict) else {}
        name = str(labels.get("alertname") or labels.get("job") or labels.get("instance") or "alert").strip()
        instance = str(labels.get("instance") or "").strip()
        if instance and instance not in name:
            name = f"{name} ({instance})"
        state = str(alert.get("state") or alert.get("status") or "firing").strip().lower()
        ann = alert.get("annotations") if isinstance(alert.get("annotations"), dict) else {}
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
                name=f"{label}: no firing alerts",
                kind=kind,
                status="up",
                detail="Prometheus alerts API returned empty",
                source_instance=label,
            )
        )
    return items


def test_prometheus(inst: dict) -> dict:
    try:
        base = clean_url(inst.get("url"))
        url = join_url(base, "/api/v1/status/buildinfo")
        data = request_json(
            method="GET",
            url=url,
            headers=_headers(inst),
            timeout=10,
            verify_ssl=inst.get("verify_ssl", True) is not False,
        )
        version = str(((data or {}).get("data") or {}).get("version") or "unknown")
        return {"ok": True, "message": f"Prometheus connected. Version: {version}."}
    except Exception as exc:
        return {"ok": False, "message": f"Prometheus connection failed: {exc}"}
