"""Zabbix JSON-RPC adapter."""

from __future__ import annotations

from typing import Any

from models.models import ServiceStatus
from service_monitors.base import clean_url, inst_label, make_service, map_status, request_json

_SEVERITY_STATUS = {
    "0": "degraded",
    "1": "degraded",
    "2": "degraded",
    "3": "degraded",
    "4": "down",
    "5": "down",
}


def _rpc(
    inst: dict,
    method: str,
    params: dict,
    *,
    timeout: int,
    auth: str | None = None,
) -> Any:
    base = clean_url(inst.get("url"))
    url = f"{base}/api_jsonrpc.php"
    headers = {"Content-Type": "application/json-rpc"}
    token = str(inst.get("token") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    if auth:
        body["auth"] = auth
    return request_json(
        method="POST",
        url=url,
        headers=headers,
        json_body=body,
        timeout=timeout,
        verify_ssl=inst.get("verify_ssl", True) is not False,
    )


def _login(inst: dict, *, timeout: int) -> str | None:
    user = str(inst.get("username") or "").strip()
    password = str(inst.get("password") or "")
    if not user:
        return None
    out = _rpc(
        inst,
        "user.login",
        {"username": user, "password": password},
        timeout=timeout,
    )
    return str((out or {}).get("result") or "").strip() or None


def collect_zabbix(inst: dict, *, timeout: int) -> list[ServiceStatus]:
    label = inst_label(inst)
    kind = "zabbix"
    mode = str(inst.get("mode") or "problems").strip().lower()
    auth = None
    if not str(inst.get("token") or "").strip():
        auth = _login(inst, timeout=timeout)

    if mode == "hosts":
        params: dict[str, Any] = {
            "output": ["hostid", "host", "name", "status", "available"],
            "selectGroups": ["name"],
            "filter": {"status": 0},
        }
        groups = [g.strip() for g in (inst.get("host_groups") or []) if str(g).strip()]
        if groups:
            params["groupids"] = groups
        out = _rpc(inst, "host.get", params, timeout=timeout, auth=auth)
        rows = (out or {}).get("result") or []
        items: list[ServiceStatus] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or row.get("host") or "host").strip()
            avail = str(row.get("available", "0"))
            status = {"1": "up", "2": "down"}.get(avail, "degraded")
            groups_txt = ", ".join(str(g.get("name") or "") for g in (row.get("groups") or []) if isinstance(g, dict))
            items.append(
                make_service(
                    name=name,
                    kind=kind,
                    status=status,
                    detail=groups_txt or f"available={avail}",
                    source_instance=label,
                )
            )
        return items

    min_severity = int(inst.get("min_severity") or 2)
    params = {
        "output": ["eventid", "name", "severity", "acknowledged"],
        "recent": True,
        "sortfield": ["eventid"],
        "sortorder": "DESC",
        "severities": list(range(min_severity, 6)),
    }
    out = _rpc(inst, "problem.get", params, timeout=timeout, auth=auth)
    rows = (out or {}).get("result") or []
    items = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        sev = str(row.get("severity", "0"))
        name = str(row.get("name") or "problem").strip()
        ack = "ack" if str(row.get("acknowledged")) == "1" else "open"
        items.append(
            make_service(
                name=name,
                kind=kind,
                status=_SEVERITY_STATUS.get(sev, "degraded"),
                detail=f"severity={sev} ({ack})",
                source_instance=label,
            )
        )
    if not items:
        items.append(
            make_service(
                name=f"{label}: no active problems",
                kind=kind,
                status="up",
                detail="problem.get returned empty",
                source_instance=label,
            )
        )
    return items


def test_zabbix(inst: dict) -> dict:
    try:
        auth = None
        if not str(inst.get("token") or "").strip():
            auth = _login(inst, timeout=10)
            if not auth:
                return {"ok": False, "message": "Zabbix token or username/password is required."}
        out = _rpc(inst, "apiinfo.version", {}, timeout=10, auth=auth)
        version = (out or {}).get("result") or "unknown"
        return {"ok": True, "message": f"Zabbix connected. API version: {version}."}
    except Exception as exc:
        return {"ok": False, "message": f"Zabbix connection failed: {exc}"}
