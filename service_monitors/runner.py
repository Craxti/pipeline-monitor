"""Dispatch service monitor instances to type-specific collectors."""

from __future__ import annotations

import logging
from typing import Callable

from models.models import ServiceStatus
from service_monitors import alertmanager, checkmk, databases, http_json, netdata, prtg, prometheus, uptime_kuma, zabbix
from service_monitors.base import MONITOR_KINDS, inst_label

logger = logging.getLogger(__name__)

_COLLECTORS: dict[str, Callable[..., list[ServiceStatus]]] = {
    "zabbix": zabbix.collect_zabbix,
    "prometheus": prometheus.collect_prometheus,
    "alertmanager": alertmanager.collect_alertmanager,
    "uptime_kuma": uptime_kuma.collect_uptime_kuma,
    "netdata": netdata.collect_netdata,
    "prtg": prtg.collect_prtg,
    "checkmk": checkmk.collect_checkmk,
    "http_json": http_json.collect_http_json,
    "postgres": databases.collect_database,
    "redis": databases.collect_database,
    "mongodb": databases.collect_database,
    "mysql": databases.collect_database,
    "elasticsearch": databases.collect_database,
    "kafka": databases.collect_database,
}

_TESTERS: dict[str, Callable[[dict], dict]] = {
    "zabbix": zabbix.test_zabbix,
    "prometheus": prometheus.test_prometheus,
    "alertmanager": alertmanager.test_alertmanager,
    "uptime_kuma": uptime_kuma.test_uptime_kuma,
    "netdata": netdata.test_netdata,
    "prtg": prtg.test_prtg,
    "checkmk": checkmk.test_checkmk,
    "http_json": http_json.test_http_json,
    "postgres": databases.test_database,
    "redis": databases.test_database,
    "mongodb": databases.test_database,
    "mysql": databases.test_database,
    "elasticsearch": databases.test_database,
    "kafka": databases.test_database,
}


def _instance_configured(inst: dict) -> bool:
    if str(inst.get("host") or "").strip():
        return True
    return bool(str(inst.get("url") or "").strip())


def service_monitors_enabled(cfg: dict) -> bool:
    sm = cfg.get("service_monitors") or {}
    if sm.get("enabled") is False:
        return False
    for inst in sm.get("instances") or []:
        if (
            isinstance(inst, dict)
            and inst.get("enabled", True)
            and str(inst.get("type") or "").strip()
            and _instance_configured(inst)
        ):
            return True
    return False


def collect_instance(inst: dict, *, timeout: int) -> list[ServiceStatus]:
    kind = str(inst.get("type") or "").strip().lower()
    fn = _COLLECTORS.get(kind)
    if not fn:
        raise ValueError(f"Unsupported service monitor type: {kind!r}")
    return fn(inst, timeout=timeout)


def probe_service_monitor(inst: dict) -> dict:
    kind = str(inst.get("type") or inst.get("kind") or "").strip().lower()
    tester = _TESTERS.get(kind)
    if not tester:
        return {"ok": False, "message": f"Unsupported service monitor type: {kind!r}"}
    return tester(inst)


def check_service_monitor_connection(inst: dict) -> dict:
    """Connection probe used by settings test-connection API."""
    return probe_service_monitor(inst)


def collect_service_monitors(cfg: dict) -> list[ServiceStatus]:
    sm = cfg.get("service_monitors") or {}
    if sm.get("enabled") is False:
        return []
    timeout = int(sm.get("timeout_seconds") or 15)
    out: list[ServiceStatus] = []
    for inst in sm.get("instances") or []:
        if not isinstance(inst, dict) or not inst.get("enabled", True):
            continue
        if not _instance_configured(inst):
            continue
        kind = str(inst.get("type") or "").strip().lower()
        if kind not in MONITOR_KINDS:
            logger.warning("Skipping unknown service monitor type: %s", kind)
            continue
        label = inst_label(inst)
        try:
            chunk = collect_instance(inst, timeout=timeout)
            out.extend(chunk)
            logger.info("Service monitor %s (%s): %d items", label, kind, len(chunk))
        except Exception as exc:
            logger.error("Service monitor %s (%s) failed: %s", label, kind, exc)
            out.append(
                ServiceStatus(
                    name=f"{label}: collector error",
                    kind=kind or "unknown",
                    status="down",
                    detail=str(exc),
                    source_instance=label,
                )
            )
    return out
