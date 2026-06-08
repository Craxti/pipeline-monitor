"""Netdata alarms adapter."""

from __future__ import annotations

from models.models import ServiceStatus
from service_monitors.base import clean_url, inst_label, join_url, make_service, map_status, request_json


def collect_netdata(inst: dict, *, timeout: int) -> list[ServiceStatus]:
    label = inst_label(inst)
    kind = "netdata"
    base = clean_url(inst.get("url"))
    url = join_url(base, str(inst.get("alarms_path") or "/api/v1/alarms?all"))
    data = request_json(
        method="GET",
        url=url,
        timeout=timeout,
        verify_ssl=inst.get("verify_ssl", True) is not False,
    )
    alarms = (data or {}).get("alarms") if isinstance(data, dict) else {}
    items: list[ServiceStatus] = []
    if isinstance(alarms, dict):
        for key, row in alarms.items():
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or key).strip()
            status = str(row.get("status") or "UNKNOWN").strip().lower()
            detail = str(row.get("info") or row.get("summary") or "").strip()
            items.append(
                make_service(
                    name=name,
                    kind=kind,
                    status=map_status(status),
                    detail=detail,
                    source_instance=label,
                )
            )
    if not items:
        items.append(
            make_service(
                name=f"{label}: no alarms",
                kind=kind,
                status="up",
                detail="Netdata alarms API returned empty",
                source_instance=label,
            )
        )
    return items


def test_netdata(inst: dict) -> dict:
    try:
        base = clean_url(inst.get("url"))
        url = join_url(base, "/api/v1/info")
        data = request_json(
            method="GET",
            url=url,
            timeout=10,
            verify_ssl=inst.get("verify_ssl", True) is not False,
        )
        version = str((data or {}).get("version") or "unknown")
        return {"ok": True, "message": f"Netdata connected. Version: {version}."}
    except Exception as exc:
        return {"ok": False, "message": f"Netdata connection failed: {exc}"}
