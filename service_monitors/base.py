"""Shared helpers for external service monitor adapters."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin

import requests

from models.models import ServiceStatus

logger = logging.getLogger(__name__)

MONITOR_KINDS = frozenset(
    {
        "zabbix",
        "prometheus",
        "alertmanager",
        "uptime_kuma",
        "netdata",
        "prtg",
        "checkmk",
        "http_json",
        "postgres",
        "redis",
        "mongodb",
        "mysql",
        "elasticsearch",
        "kafka",
    }
)

_DEFAULT_STATUS_MAP: dict[str, str] = {
    "up": "up",
    "ok": "up",
    "healthy": "up",
    "running": "up",
    "online": "up",
    "available": "up",
    "clear": "up",
    "active": "down",
    "firing": "down",
    "critical": "down",
    "disaster": "down",
    "high": "down",
    "down": "down",
    "offline": "down",
    "unavailable": "down",
    "unreachable": "down",
    "failed": "down",
    "error": "down",
    "warning": "degraded",
    "warn": "degraded",
    "degraded": "degraded",
    "average": "degraded",
    "pending": "degraded",
    "unknown": "degraded",
    "maintenance": "degraded",
    "suppressed": "up",
}


def clean_url(value: Any) -> str:
    return str(value or "").strip().rstrip("/")


def inst_label(inst: dict) -> str:
    return str(inst.get("name") or inst.get("url") or inst.get("type") or "monitor").strip()


def map_status(raw: Any, status_map: dict[str, str] | None = None) -> str:
    key = str(raw or "").strip().lower()
    merged = dict(_DEFAULT_STATUS_MAP)
    if status_map:
        merged.update({str(k).strip().lower(): str(v).strip().lower() for k, v in status_map.items()})
    return merged.get(key, key or "unknown")


def make_service(
    *,
    name: str,
    kind: str,
    status: str,
    detail: str | None = None,
    source_instance: str | None = None,
) -> ServiceStatus:
    return ServiceStatus(
        name=name,
        kind=kind,
        status=status,
        detail=detail,
        source_instance=source_instance,
        checked_at=datetime.now(tz=timezone.utc),
    )


def request_json(
    *,
    method: str,
    url: str,
    timeout: int = 15,
    headers: dict[str, str] | None = None,
    json_body: dict | None = None,
    auth: tuple[str, str] | None = None,
    verify_ssl: bool = True,
    cookies: dict[str, str] | None = None,
) -> Any:
    resp = requests.request(
        method=method.upper(),
        url=url,
        headers=headers,
        json=json_body,
        auth=auth,
        timeout=max(3, int(timeout)),
        verify=verify_ssl,
        cookies=cookies,
    )
    resp.raise_for_status()
    if not resp.content:
        return {}
    return resp.json()


def join_url(base: str, path: str) -> str:
    base = clean_url(base)
    if not base:
        return path
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return urljoin(base + "/", path.lstrip("/"))


def dig_path(data: Any, path: str) -> Any:
    cur = data
    for part in str(path or "").split("."):
        part = part.strip()
        if not part:
            continue
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list):
            try:
                cur = cur[int(part)]
            except (ValueError, IndexError, TypeError):
                return None
        else:
            return None
    return cur


def as_item_list(data: Any, items_path: str) -> list[dict]:
    if items_path:
        data = dig_path(data, items_path)
    if data is None:
        return []
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    if isinstance(data, dict):
        return [data]
    return []
