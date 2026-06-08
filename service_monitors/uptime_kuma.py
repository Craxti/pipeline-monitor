"""Uptime Kuma adapter."""

from __future__ import annotations

from models.models import ServiceStatus
from service_monitors.base import clean_url, inst_label, join_url, make_service, map_status, request_json

_STATUS_MAP = {
    "0": "down",
    "1": "up",
    "2": "degraded",
    "3": "degraded",
}


def _session_cookie(inst: dict, *, timeout: int) -> dict[str, str]:
    api_key = str(inst.get("api_key") or inst.get("token") or "").strip()
    if api_key:
        return {}
    user = str(inst.get("username") or "").strip()
    password = str(inst.get("password") or "")
    if not user:
        return {}
    base = clean_url(inst.get("url"))
    login_url = join_url(base, "/api/login")
    resp = request_json(
        method="POST",
        url=login_url,
        json_body={"username": user, "password": password},
        timeout=timeout,
        verify_ssl=inst.get("verify_ssl", True) is not False,
    )
    token = str((resp or {}).get("token") or "").strip()
    if token:
        return {"token": token}
    return {}


def _headers(inst: dict) -> dict[str, str]:
    api_key = str(inst.get("api_key") or inst.get("token") or "").strip()
    if not api_key:
        return {}
    return {"Authorization": f"Bearer {api_key}"}


def collect_uptime_kuma(inst: dict, *, timeout: int) -> list[ServiceStatus]:
    label = inst_label(inst)
    kind = "uptime_kuma"
    base = clean_url(inst.get("url"))
    cookies = _session_cookie(inst, timeout=timeout)
    url = join_url(base, str(inst.get("monitors_path") or "/api/monitors"))
    data = request_json(
        method="GET",
        url=url,
        headers=_headers(inst),
        cookies=cookies or None,
        timeout=timeout,
        verify_ssl=inst.get("verify_ssl", True) is not False,
    )
    rows = data if isinstance(data, list) else []
    items: list[ServiceStatus] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or f"monitor-{row.get('id', '?')}").strip()
        if row.get("active") is False:
            continue
        status_code = str(row.get("status", "1"))
        status = _STATUS_MAP.get(status_code, map_status(status_code))
        detail = str(row.get("type") or row.get("url") or "").strip()
        items.append(
            make_service(
                name=name,
                kind=kind,
                status=status,
                detail=detail,
                source_instance=label,
            )
        )
    if not items:
        items.append(
            make_service(
                name=f"{label}: no monitors",
                kind=kind,
                status="degraded",
                detail="Uptime Kuma returned empty monitor list",
                source_instance=label,
            )
        )
    return items


def test_uptime_kuma(inst: dict) -> dict:
    try:
        items = collect_uptime_kuma(inst, timeout=10)
        return {"ok": True, "message": f"Uptime Kuma connected. Monitors: {len(items)}."}
    except Exception as exc:
        return {"ok": False, "message": f"Uptime Kuma connection failed: {exc}"}
