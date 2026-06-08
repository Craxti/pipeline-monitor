"""Generic HTTP JSON adapter for custom monitoring APIs."""

from __future__ import annotations

from models.models import ServiceStatus
from service_monitors.base import as_item_list, clean_url, dig_path, inst_label, make_service, map_status, request_json


def collect_http_json(inst: dict, *, timeout: int) -> list[ServiceStatus]:
    label = inst_label(inst)
    kind = "http_json"
    url = clean_url(inst.get("url"))
    headers = {}
    token = str(inst.get("token") or inst.get("bearer_token") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = request_json(
        method=str(inst.get("method") or "GET").upper(),
        url=url,
        headers=headers,
        timeout=timeout,
        verify_ssl=inst.get("verify_ssl", True) is not False,
    )
    items_path = str(inst.get("items_path") or "data").strip()
    name_field = str(inst.get("name_field") or "name").strip()
    status_field = str(inst.get("status_field") or "status").strip()
    detail_field = str(inst.get("detail_field") or "detail").strip()
    status_map = inst.get("status_map") if isinstance(inst.get("status_map"), dict) else {}
    rows = as_item_list(data, items_path)
    items: list[ServiceStatus] = []
    for row in rows:
        name = str(dig_path(row, name_field) or "item").strip()
        status_raw = dig_path(row, status_field)
        detail_val = dig_path(row, detail_field)
        detail = str(detail_val).strip() if detail_val is not None else ""
        items.append(
            make_service(
                name=name,
                kind=kind,
                status=map_status(status_raw, status_map),
                detail=detail or None,
                source_instance=label,
            )
        )
    if not items:
        items.append(
            make_service(
                name=f"{label}: empty response",
                kind=kind,
                status="degraded",
                detail=f"No items at path '{items_path}'",
                source_instance=label,
            )
        )
    return items


def test_http_json(inst: dict) -> dict:
    try:
        items = collect_http_json(inst, timeout=10)
        return {"ok": True, "message": f"HTTP JSON endpoint OK. Parsed items: {len(items)}."}
    except Exception as exc:
        return {"ok": False, "message": f"HTTP JSON connection failed: {exc}"}
