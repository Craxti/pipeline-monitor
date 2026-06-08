"""Checkmk REST API adapter."""

from __future__ import annotations

from models.models import ServiceStatus
from service_monitors.base import clean_url, inst_label, join_url, make_service, map_status, request_json


def _api_base(inst: dict) -> str:
    base = clean_url(inst.get("url"))
    site = str(inst.get("site") or "").strip().strip("/")
    if site and f"/{site}/" not in base:
        return join_url(base, f"{site}/check_mk/api/1.0")
    if base.endswith("/check_mk/api/1.0"):
        return base
    return join_url(base, "check_mk/api/1.0")


def _headers(inst: dict) -> dict[str, str]:
    token = str(inst.get("token") or inst.get("bearer_token") or "").strip()
    user = str(inst.get("username") or "").strip()
    password = str(inst.get("password") or "")
    if token:
        return {"Authorization": f"Bearer {token}"}
    if user:
        import base64

        raw = base64.b64encode(f"{user}:{password}".encode("utf-8")).decode("ascii")
        return {"Authorization": f"Basic {raw}"}
    return {}


def collect_checkmk(inst: dict, *, timeout: int) -> list[ServiceStatus]:
    label = inst_label(inst)
    kind = "checkmk"
    url = join_url(_api_base(inst), "domain-types/host/collections/all")
    data = request_json(
        method="GET",
        url=url,
        headers={**_headers(inst), "Accept": "application/json"},
        timeout=timeout,
        verify_ssl=inst.get("verify_ssl", True) is not False,
    )
    rows = (data or {}).get("value") if isinstance(data, dict) else []
    if not isinstance(rows, list):
        rows = []
    items: list[ServiceStatus] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        ext = row.get("extensions") if isinstance(row.get("extensions"), dict) else {}
        name = str(row.get("title") or row.get("id") or ext.get("name") or "host").strip()
        state = str(ext.get("state") or ext.get("status") or row.get("status") or "UNKNOWN").strip().lower()
        detail = str(ext.get("description") or ext.get("address") or state).strip()
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
                name=f"{label}: no hosts",
                kind=kind,
                status="degraded",
                detail="Checkmk hosts collection returned empty",
                source_instance=label,
            )
        )
    return items


def test_checkmk(inst: dict) -> dict:
    try:
        url = join_url(_api_base(inst), "version")
        data = request_json(
            method="GET",
            url=url,
            headers={**_headers(inst), "Accept": "application/json"},
            timeout=10,
            verify_ssl=inst.get("verify_ssl", True) is not False,
        )
        version = str((data or {}).get("site") or (data or {}).get("versions") or "unknown")
        return {"ok": True, "message": f"Checkmk connected. {version}."}
    except Exception as exc:
        return {"ok": False, "message": f"Checkmk connection failed: {exc}"}
