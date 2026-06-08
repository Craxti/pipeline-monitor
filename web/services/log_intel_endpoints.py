"""API handlers for service analysis (clustering + correlation)."""

from __future__ import annotations

from typing import Any, Callable
from urllib.parse import unquote

from fastapi import HTTPException

from web.services.configured_services import (
    list_configured_services,
    merge_service_sources,
    service_exists,
)
from web.services.log_intelligence import registry
from web.services.log_intelligence.service_keys import make_service_key, parse_service_key
from web.services.log_intelligence.store import log_intel_store


def _snapshot_services(load_snapshot: Callable[[], Any]) -> list[dict[str, Any]]:
    snap = load_snapshot()
    services = []
    for s in getattr(snap, "services", None) or []:
        services.append(
            {
                "name": getattr(s, "name", ""),
                "kind": getattr(s, "kind", ""),
                "status": getattr(s, "status", ""),
                "source_instance": getattr(s, "source_instance", ""),
                "detail": getattr(s, "detail", ""),
            }
        )
    return services


def _all_services(
    load_snapshot: Callable[[], Any],
    load_cfg: Callable[[], dict] | None = None,
) -> list[dict[str, Any]]:
    snapshot = _snapshot_services(load_snapshot)
    if load_cfg is None:
        return snapshot
    configured = list_configured_services(load_cfg())
    return merge_service_sources(snapshot, configured)


def _parse_service_key_param(key: str) -> tuple[str, str, str, str]:
    raw = unquote(key)
    try:
        host, kind, name = parse_service_key(raw)
    except ValueError as exc:
        raise HTTPException(400, "Invalid service key") from exc
    if not name:
        raise HTTPException(400, "Empty service name")
    model_key = make_service_key(kind=kind, name=name, source_instance=host)
    return host, kind, name, model_key


def _require_registry_entry(model_id: int) -> dict[str, Any]:
    entry = registry.get_entry(model_id)
    if not entry:
        raise HTTPException(404, "Analysis model not found")
    return entry


def _detail_for_entry(entry: dict[str, Any]) -> dict[str, Any]:
    key = str(entry.get("service_key") or "")
    host = str(entry.get("source_instance") or "")
    kind = str(entry.get("service_kind") or "docker")
    name = str(entry.get("service_name") or "")
    model = log_intel_store.get(key)
    if model is None:
        model = log_intel_store.get_or_create(name=name, kind=kind, source_instance=host)
    out = model.detail_payload()
    out["ok"] = True
    out["id"] = entry.get("id")
    out["display_name"] = entry.get("display_name")
    out["enabled"] = bool(entry.get("enabled"))
    out["watched"] = bool(entry.get("enabled"))
    out["live_learning"] = bool(entry.get("enabled"))
    from web.services.log_intelligence import incident_store

    out["open_incident"] = incident_store.find_open_incident(key)
    return out


def api_list_models(*, load_snapshot: Callable[[], Any]) -> dict[str, Any]:
    services = _snapshot_services(load_snapshot)
    return {"ok": True, "items": log_intel_store.list_registry_summaries(services)}


def api_list_candidates(
    *,
    load_snapshot: Callable[[], Any],
    load_cfg: Callable[[], dict] | None = None,
) -> dict[str, Any]:
    services = _all_services(load_snapshot, load_cfg)
    registered = {e.get("service_key") for e in registry.list_entries()}
    items = []
    for sv in services:
        kind = str(sv.get("kind") or "unknown").strip().lower()
        name = str(sv.get("name") or "").strip()
        if not name:
            continue
        host = str(sv.get("source_instance") or "")
        key = make_service_key(kind=kind, name=name, source_instance=host)
        if key in registered:
            continue
        label = name if not host else f"{name} @ {host}"
        items.append(
            {
                "key": key,
                "name": name,
                "kind": kind,
                "source_instance": host,
                "status": sv.get("status") or "",
                "label": label,
            }
        )
    items.sort(key=lambda x: (str(x.get("kind") or ""), str(x.get("name") or "")))
    return {"ok": True, "items": items}


def api_create_model(
    *,
    body: dict[str, Any],
    load_snapshot: Callable[[], Any],
    load_cfg: Callable[[], dict] | None = None,
) -> dict[str, Any]:
    display_name = str(body.get("display_name") or body.get("name") or "").strip()
    service_key = str(body.get("service_key") or body.get("key") or "").strip()
    enabled = bool(body.get("enabled", True))
    if not service_key:
        raise HTTPException(400, "service_key is required")
    host, kind, name, model_key = _parse_service_key_param(service_key)
    if registry.get_entry_by_key(model_key):
        raise HTTPException(409, "Model for this service already exists")

    services = _all_services(load_snapshot, load_cfg)
    if not service_exists(services, name=name, kind=kind, source_instance=host):
        raise HTTPException(404, "Service not found (run Collect or check integration settings)")

    if not display_name:
        display_name = name

    try:
        entry = log_intel_store.create_registry_model(
            display_name=display_name,
            service_key=model_key,
            enabled=enabled,
        )
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc

    services = _all_services(load_snapshot, load_cfg)
    summaries = log_intel_store.list_registry_summaries(services)
    row = next((x for x in summaries if x.get("id") == entry.get("id")), None)
    return {"ok": True, "item": row or entry}


def api_update_model(*, model_id: int, body: dict[str, Any]) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    if "display_name" in body or "name" in body:
        dn = str(body.get("display_name") or body.get("name") or "").strip()
        if not dn:
            raise HTTPException(400, "display_name cannot be empty")
        fields["display_name"] = dn
    if "enabled" in body:
        fields["enabled"] = bool(body.get("enabled"))
    if not fields:
        raise HTTPException(400, "Nothing to update")
    entry = log_intel_store.update_registry_model(model_id, **fields)
    if not entry:
        raise HTTPException(404, "Analysis model not found")
    return {"ok": True, "item": entry}


def api_delete_model(*, model_id: int) -> dict[str, Any]:
    entry = log_intel_store.delete_registry_model(model_id)
    if not entry:
        raise HTTPException(404, "Analysis model not found")
    return {"ok": True, "deleted": entry}


def api_model_detail(*, model_id: int) -> dict[str, Any]:
    entry = _require_registry_entry(model_id)
    return _detail_for_entry(entry)


def api_model_detail_by_key(key: str) -> dict[str, Any]:
    _, _, _, model_key = _parse_service_key_param(key)
    entry = registry.get_entry_by_key(model_key)
    if not entry:
        raise HTTPException(404, "Analysis model not found")
    return _detail_for_entry(entry)


def api_list_services(*, load_snapshot: Callable[[], Any]) -> dict[str, Any]:
    return api_list_models(load_snapshot=load_snapshot)


def api_service_detail(key: str) -> dict[str, Any]:
    _, _, _, model_key = _parse_service_key_param(key)
    entry = registry.get_entry_by_key(model_key)
    if not entry:
        raise HTTPException(404, "Analysis model not found — create it first")
    return _detail_for_entry(entry)


def api_set_watch(*, key: str, watched: bool) -> dict[str, Any]:
    _, _, _, model_key = _parse_service_key_param(key)
    entry = registry.get_entry_by_key(model_key)
    if not entry:
        raise HTTPException(404, "Analysis model not found")
    updated = log_intel_store.update_registry_model(int(entry["id"]), enabled=bool(watched))
    model = log_intel_store.get(model_key)
    return {
        "ok": True,
        "watched": bool(watched),
        "enabled": bool(watched),
        "summary": model.summary() if model else {},
    }


def _train_service_key(
    *, model_key: str, host: str, kind: str, name: str, load_cfg: Callable[[], dict], tail: int
) -> dict[str, Any]:
    from web.services.logs_api import docker_logs_tail

    cfg = load_cfg()
    if kind == "docker":
        res = docker_logs_tail(
            cfg=cfg,
            container=name,
            tail=max(200, min(20_000, int(tail))),
            docker_host=host,
        )
        text = str(res.get("log") or "")
        n = log_intel_store.train_ingest(name=name, kind=kind, source_instance=host, text=text)
    else:
        from web.core.snapshot_cache import load_snapshot

        snap = load_snapshot()
        svc = None
        for s in getattr(snap, "services", None) or []:
            if (
                str(getattr(s, "name", "")) == name
                and str(getattr(s, "kind", "")).lower() == kind
                and str(getattr(s, "source_instance", "") or "") == host
            ):
                svc = s
                break
        if svc is None:
            raise HTTPException(404, "Service not found in snapshot")
        st = str(getattr(svc, "status", "") or "")
        detail = str(getattr(svc, "detail", "") or "")
        line = f"[INFO] service_status={st}"
        if detail:
            line += f" detail={detail[:400]}"
        n = log_intel_store.train_ingest(name=name, kind=kind, source_instance=host, text=line + "\n", source=kind)
    model = log_intel_store.get_or_create(name=name, kind=kind, source_instance=host)
    log_intel_store.persist_all()
    return {"ok": True, "lines_ingested": n, "summary": model.summary()}


def api_train_model(*, model_id: int, load_cfg: Callable[[], dict], tail: int = 3000) -> dict[str, Any]:
    entry = _require_registry_entry(model_id)
    host = str(entry.get("source_instance") or "")
    kind = str(entry.get("service_kind") or "docker")
    name = str(entry.get("service_name") or "")
    model_key = str(entry.get("service_key") or "")
    try:
        return _train_service_key(
            model_key=model_key,
            host=host,
            kind=kind,
            name=name,
            load_cfg=load_cfg,
            tail=tail,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"Could not train model: {exc}") from exc


def api_train_service(
    *,
    key: str,
    load_cfg: Callable[[], dict],
    tail: int = 3000,
) -> dict[str, Any]:
    host, kind, name, model_key = _parse_service_key_param(key)
    entry = registry.get_entry_by_key(model_key)
    if not entry:
        raise HTTPException(404, "Analysis model not found")
    try:
        return _train_service_key(
            model_key=model_key,
            host=host,
            kind=kind,
            name=name,
            load_cfg=load_cfg,
            tail=tail,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"Could not train model: {exc}") from exc


# Backward-compatible aliases
api_list_containers = api_list_services
api_container_detail = api_service_detail
api_train_container = api_train_service
