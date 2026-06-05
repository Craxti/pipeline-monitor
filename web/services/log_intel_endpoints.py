"""API handlers for container log intelligence."""

from __future__ import annotations

from typing import Any, Callable
from urllib.parse import unquote

from fastapi import HTTPException

from web.services.log_intelligence.store import log_intel_store


def _parse_container_key(key: str) -> tuple[str, str, str]:
    raw = unquote(key)
    if "::" not in raw:
        raise HTTPException(400, "Invalid container key")
    host, container = raw.split("::", 1)
    container = container.strip()
    if not container:
        raise HTTPException(400, "Empty container name")
    model_key = f"{host}::{container}"
    return host, container, model_key


def api_list_containers(*, load_snapshot: Callable[[], Any]) -> dict[str, Any]:
    snap = load_snapshot()
    services = []
    for s in getattr(snap, "services", None) or []:
        services.append(
            {
                "name": getattr(s, "name", ""),
                "kind": getattr(s, "kind", ""),
                "status": getattr(s, "status", ""),
                "source_instance": getattr(s, "source_instance", ""),
            }
        )
    return {"ok": True, "items": log_intel_store.list_summaries(services)}


def api_container_detail(key: str) -> dict[str, Any]:
    host, container, model_key = _parse_container_key(key)
    model = log_intel_store.get(model_key)
    if model is None:
        model = log_intel_store.get_or_create(container=container, docker_host=host)
    out = model.detail_payload()
    out["ok"] = True
    out["watched"] = log_intel_store.is_watched(model_key)
    out["live_learning"] = True
    return out


def api_set_watch(*, key: str, watched: bool) -> dict[str, Any]:
    host, container, model_key = _parse_container_key(key)
    log_intel_store.get_or_create(container=container, docker_host=host)
    log_intel_store.set_watched(model_key, bool(watched))
    model = log_intel_store.get(model_key)
    return {
        "ok": True,
        "watched": bool(watched),
        "summary": model.summary() if model else {},
    }


def api_train_container(
    *,
    key: str,
    load_cfg: Callable[[], dict],
    tail: int = 3000,
) -> dict[str, Any]:
    from web.services.logs_api import docker_logs_tail

    host, container, model_key = _parse_container_key(key)
    cfg = load_cfg()
    try:
        res = docker_logs_tail(
            cfg=cfg,
            container=container,
            tail=max(200, min(20_000, int(tail))),
            docker_host=host,
        )
        text = str(res.get("log") or "")
        n = log_intel_store.ingest(container=container, docker_host=host, text=text)
        model = log_intel_store.get_or_create(container=container, docker_host=host)
        return {"ok": True, "lines_ingested": n, "summary": model.summary()}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"Could not train model: {exc}") from exc
