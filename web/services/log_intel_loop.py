"""Background loop: ingest Docker container logs and train live models."""

from __future__ import annotations

import asyncio
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable

from web.services.log_intelligence.notifier import emit_anomaly_notifications
from web.services.log_intelligence.store import log_intel_store

logger = logging.getLogger(__name__)

_DEFAULT_INTERVAL = 45
_DEFAULT_TAIL = 2000
_DEFAULT_WORKERS = 6


class LogIntelLoop:
    """Poll docker logs for monitored containers and update models."""

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
                enabled = bool(web_cfg.get("log_intel_enabled", True))
                interval = int(web_cfg.get("log_intel_interval_seconds", _DEFAULT_INTERVAL) or _DEFAULT_INTERVAL)
                interval = max(20, min(600, interval))
                tail = int(web_cfg.get("log_intel_tail_lines", _DEFAULT_TAIL) or _DEFAULT_TAIL)
                tail = max(200, min(10_000, tail))
                workers = int(web_cfg.get("log_intel_workers", _DEFAULT_WORKERS) or _DEFAULT_WORKERS)
                workers = max(1, min(16, workers))
                if enabled and cfg.get("docker_monitor", {}).get("enabled", True):
                    await asyncio.to_thread(
                        self._ingest_once,
                        cfg,
                        load_snapshot,
                        tail,
                        append_event,
                        workers,
                    )
            except Exception:
                logger.exception("log-intel loop error")

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
        docker_svcs = [
            s for s in services if str(getattr(s, "kind", "") or (isinstance(s, dict) and s.get("kind"))) == "docker"
        ]
        if not docker_svcs:
            return

        notify_lock = threading.Lock()

        def _ingest_one(sv: object) -> None:
            name = str(getattr(sv, "name", "") or (sv.get("name") if isinstance(sv, dict) else "")).strip()
            if not name:
                return
            host = str(
                getattr(sv, "source_instance", "") or (sv.get("source_instance") if isinstance(sv, dict) else "")
            )
            try:
                res = docker_logs_tail(cfg=cfg, container=name, tail=tail, docker_host=host)
                text = str(res.get("log") or "")
                n = log_intel_store.ingest(container=name, docker_host=host, text=text)
                if n:
                    model = log_intel_store.get_or_create(container=name, docker_host=host)
                    new_anom = model.pop_new_anomalies()
                    if new_anom:
                        with notify_lock:
                            self._notify_id_seq = emit_anomaly_notifications(
                                anomalies=new_anom,
                                container=name,
                                notify_append=append_event,
                                notify_id_seq=self._notify_id_seq,
                            )
                            if self._set_notify_id_seq:
                                self._set_notify_id_seq(self._notify_id_seq)
            except Exception as exc:
                logger.debug("log-intel ingest skip %s: %s", name, exc)

        if workers <= 1 or len(docker_svcs) <= 1:
            for sv in docker_svcs:
                _ingest_one(sv)
            return

        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="log-intel") as pool:
            futures = [pool.submit(_ingest_one, sv) for sv in docker_svcs]
            for fut in as_completed(futures):
                try:
                    fut.result()
                except Exception:
                    logger.debug("log-intel worker failed", exc_info=True)
