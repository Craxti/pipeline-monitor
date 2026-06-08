"""Background loop: ingest service events and maintain analysis models."""

from __future__ import annotations

import asyncio
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable

from models.models import normalize_service_status
from web.services.log_intelligence import incident_store
from web.services.log_intelligence.notifier import emit_anomaly_notifications, emit_incident_resolved
from web.services.log_intelligence.service_keys import make_service_key
from web.services.log_intelligence.store import log_intel_store

logger = logging.getLogger(__name__)

_DEFAULT_INTERVAL = 45
_DEFAULT_TAIL = 2000
_DEFAULT_WORKERS = 6


class LogIntelLoop:
    """Poll services and update clustering/correlation models."""

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self._notify_id_seq = 0
        self._set_notify_id_seq: Callable[[int], None] | None = None

    def start(
        self,
        *,
        load_cfg: Callable[[], dict],
        load_snapshot: Callable[[], Any],
        append_event: Callable[[list[dict]], None] | None,
        get_notify_id_seq: Callable[[], int],
        set_notify_id_seq: Callable[[int], None] | None = None,
    ) -> None:
        if self._task and not self._task.done():
            return
        self._stop = asyncio.Event()
        self._notify_id_seq = get_notify_id_seq()
        self._set_notify_id_seq = set_notify_id_seq
        self._task = asyncio.create_task(
            self._run(
                load_cfg=load_cfg,
                load_snapshot=load_snapshot,
                append_event=append_event,
            )
        )

    async def stop(self) -> None:
        self._stop.set()
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None

    async def _run(
        self,
        *,
        load_cfg: Callable[[], dict],
        load_snapshot: Callable[[], Any],
        append_event: Callable[[list[dict]], None] | None,
    ) -> None:
        while not self._stop.is_set():
            interval = _DEFAULT_INTERVAL
            try:
                cfg = await asyncio.to_thread(load_cfg)
                web_cfg = cfg.get("web", {}) if isinstance(cfg.get("web"), dict) else {}
                enabled = bool(web_cfg.get("service_intel_enabled", web_cfg.get("log_intel_enabled", True)))
                interval = int(
                    web_cfg.get(
                        "service_intel_interval_seconds", web_cfg.get("log_intel_interval_seconds", _DEFAULT_INTERVAL)
                    )
                    or _DEFAULT_INTERVAL
                )
                interval = max(20, min(600, interval))
                tail = int(web_cfg.get("log_intel_tail_lines", _DEFAULT_TAIL) or _DEFAULT_TAIL)
                tail = max(200, min(10_000, tail))
                workers = int(web_cfg.get("log_intel_workers", _DEFAULT_WORKERS) or _DEFAULT_WORKERS)
                workers = max(1, min(16, workers))
                if enabled:
                    await asyncio.to_thread(
                        self._ingest_once,
                        cfg,
                        load_snapshot,
                        tail,
                        append_event,
                        workers,
                    )
            except Exception:
                logger.exception("service-intel loop error")

            try:
                await asyncio.wait_for(self._stop.wait(), timeout=interval)
            except asyncio.TimeoutError:
                continue

    def _ingest_once(
        self,
        cfg: dict,
        load_snapshot: Callable[[], Any],
        tail: int,
        append_event: Callable[[list[dict]], None] | None,
        workers: int,
    ) -> None:
        from web.services.logs_api import docker_logs_tail

        snap = load_snapshot()
        services = getattr(snap, "services", None) or []
        if not services:
            return

        notify_lock = threading.Lock()
        enabled_keys = {e["service_key"] for e in log_intel_store.list_registry_summaries(None) if e.get("enabled")}
        if not enabled_keys:
            return

        def _process_one(sv: object) -> None:
            name = str(getattr(sv, "name", "") or (sv.get("name") if isinstance(sv, dict) else "")).strip()
            if not name:
                return
            kind = str(getattr(sv, "kind", "") or (sv.get("kind") if isinstance(sv, dict) else "")).strip().lower()
            host = str(
                getattr(sv, "source_instance", "") or (sv.get("source_instance") if isinstance(sv, dict) else "")
            )
            status = normalize_service_status(
                str(getattr(sv, "status", "") or (sv.get("status") if isinstance(sv, dict) else ""))
            )
            detail = str(getattr(sv, "detail", "") or (sv.get("detail") if isinstance(sv, dict) else ""))
            key = make_service_key(kind=kind, name=name, source_instance=host)
            if key not in enabled_keys:
                return

            try:
                if kind == "docker":
                    res = docker_logs_tail(cfg=cfg, container=name, tail=tail, docker_host=host)
                    text = str(res.get("log") or "")
                    log_intel_store.ingest(name=name, kind=kind, source_instance=host, text=text)
                else:
                    log_intel_store.note_service_status(
                        name=name,
                        kind=kind,
                        source_instance=host,
                        status=status,
                        detail=detail,
                    )

                if status == "up":
                    resolved = incident_store.resolve_incidents_for_service(key)
                    if resolved:
                        with notify_lock:
                            self._notify_id_seq = emit_incident_resolved(
                                incident_ids=resolved,
                                service_name=name,
                                service_kind=kind,
                                notify_append=append_event,
                                notify_id_seq=self._notify_id_seq,
                            )
                            if self._set_notify_id_seq:
                                self._set_notify_id_seq(self._notify_id_seq)

                model = log_intel_store.get(key)
                if model is None:
                    return
                new_anom = model.pop_new_anomalies()
                if new_anom:
                    with notify_lock:
                        self._notify_id_seq = emit_anomaly_notifications(
                            anomalies=new_anom,
                            model=model,
                            notify_append=append_event,
                            notify_id_seq=self._notify_id_seq,
                        )
                        if self._set_notify_id_seq:
                            self._set_notify_id_seq(self._notify_id_seq)
            except Exception as exc:
                logger.debug("service-intel skip %s: %s", key, exc)

        enabled_services = []
        for sv in services:
            name = str(getattr(sv, "name", "") or "").strip()
            if not name:
                continue
            kind = str(getattr(sv, "kind", "") or "").strip().lower()
            host = str(getattr(sv, "source_instance", "") or "")
            key = make_service_key(kind=kind, name=name, source_instance=host)
            if key in enabled_keys:
                enabled_services.append(sv)

        if not enabled_services:
            return

        if workers <= 1 or len(enabled_services) <= 1:
            for sv in enabled_services:
                _process_one(sv)
            return

        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="svc-intel") as pool:
            futures = [pool.submit(_process_one, sv) for sv in enabled_services]
            for fut in as_completed(futures):
                try:
                    fut.result()
                except Exception:
                    logger.debug("service-intel worker failed", exc_info=True)
