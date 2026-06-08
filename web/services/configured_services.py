"""Service-shaped rows derived from saved integrations (config.yaml)."""

from __future__ import annotations

from typing import Any

from service_monitors.base import inst_label
from service_monitors.runner import _instance_configured
from web.services.log_intelligence.service_keys import make_service_key


def list_configured_services(cfg: dict) -> list[dict[str, Any]]:
    """Return enabled integrations as service dicts (before or without Collect)."""
    out: list[dict[str, Any]] = []

    sm = cfg.get("service_monitors") or {}
    if sm.get("enabled") is not False:
        for inst in sm.get("instances") or []:
            if not isinstance(inst, dict) or inst.get("enabled", True) is False:
                continue
            kind = str(inst.get("type") or "").strip().lower()
            if not kind or not _instance_configured(inst):
                continue
            label = inst_label(inst)
            out.append(
                {
                    "name": label,
                    "kind": kind,
                    "status": "unknown",
                    "source_instance": label,
                    "detail": "",
                    "from_config": True,
                }
            )

    dm = cfg.get("docker_monitor") or {}
    if dm.get("enabled", True) is not False:
        for hc in dm.get("http_checks") or []:
            if not isinstance(hc, dict):
                continue
            name = str(hc.get("name") or "").strip()
            url = str(hc.get("url") or "").strip()
            if not name or not url:
                continue
            out.append(
                {
                    "name": name,
                    "kind": "http",
                    "status": "unknown",
                    "source_instance": "",
                    "detail": url,
                    "from_config": True,
                }
            )

    return out


def merge_service_sources(
    snapshot_services: list[dict[str, Any]],
    config_services: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Merge snapshot + config services; snapshot rows win on key collision."""
    merged: dict[str, dict[str, Any]] = {}
    for sv in config_services:
        key = make_service_key(
            kind=str(sv.get("kind") or "unknown"),
            name=str(sv.get("name") or ""),
            source_instance=str(sv.get("source_instance") or ""),
        )
        merged[key] = dict(sv)
    for sv in snapshot_services:
        key = make_service_key(
            kind=str(sv.get("kind") or "unknown"),
            name=str(sv.get("name") or ""),
            source_instance=str(sv.get("source_instance") or ""),
        )
        merged[key] = dict(sv)
    return list(merged.values())


def service_exists(
    services: list[dict[str, Any]],
    *,
    name: str,
    kind: str,
    source_instance: str,
) -> bool:
    n = str(name or "").strip()
    k = str(kind or "").strip().lower()
    h = str(source_instance or "").strip()
    for s in services:
        if (
            str(s.get("name") or "").strip() == n
            and str(s.get("kind") or "").strip().lower() == k
            and str(s.get("source_instance") or "").strip() == h
        ):
            return True
    return False
