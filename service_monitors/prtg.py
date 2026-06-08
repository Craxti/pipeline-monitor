"""PRTG Network Monitor adapter."""

from __future__ import annotations

from urllib.parse import urlencode

from models.models import ServiceStatus
from service_monitors.base import clean_url, inst_label, join_url, make_service, map_status, request_json


def _query(inst: dict, params: dict[str, str]) -> str:
    user = str(inst.get("username") or inst.get("user") or "").strip()
    passhash = str(inst.get("passhash") or inst.get("token") or inst.get("password") or "").strip()
    if user:
        params["username"] = user
    if passhash:
        params["passhash"] = passhash
    return urlencode(params)


def collect_prtg(inst: dict, *, timeout: int) -> list[ServiceStatus]:
    label = inst_label(inst)
    kind = "prtg"
    base = clean_url(inst.get("url"))
    path = str(inst.get("sensors_path") or "/api/table.json")
    params = {
        "content": "sensors",
        "columns": "objid,device,sensor,status,message",
        "count": str(int(inst.get("max_items") or 500)),
    }
    url = f"{join_url(base, path)}?{_query(inst, params)}"
    data = request_json(
        method="GET",
        url=url,
        timeout=timeout,
        verify_ssl=inst.get("verify_ssl", True) is not False,
    )
    rows = (data or {}).get("sensors") if isinstance(data, dict) else []
    if not isinstance(rows, list):
        rows = []
    items: list[ServiceStatus] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        device = str(row.get("device") or "").strip()
        sensor = str(row.get("sensor") or "sensor").strip()
        name = f"{device} / {sensor}" if device else sensor
        status_raw = str(row.get("status") or "").strip().lower()
        detail = str(row.get("message") or status_raw).strip()
        items.append(
            make_service(
                name=name,
                kind=kind,
                status=map_status(status_raw),
                detail=detail,
                source_instance=label,
            )
        )
    if not items:
        items.append(
            make_service(
                name=f"{label}: no sensors",
                kind=kind,
                status="degraded",
                detail="PRTG sensors table returned empty",
                source_instance=label,
            )
        )
    return items


def test_prtg(inst: dict) -> dict:
    try:
        base = clean_url(inst.get("url"))
        params = {"content": "sensors", "columns": "objid", "count": "1"}
        url = f"{join_url(base, '/api/table.json')}?{_query(inst, params)}"
        request_json(
            method="GET",
            url=url,
            timeout=10,
            verify_ssl=inst.get("verify_ssl", True) is not False,
        )
        return {"ok": True, "message": "PRTG API connected."}
    except Exception as exc:
        return {"ok": False, "message": f"PRTG connection failed: {exc}"}
