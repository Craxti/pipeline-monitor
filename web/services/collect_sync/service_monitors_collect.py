"""Collect external service monitors (Zabbix, Prometheus, etc.)."""

from __future__ import annotations

import time
from threading import Lock

from service_monitors.base import MONITOR_KINDS
from service_monitors.runner import _instance_configured, service_monitors_enabled
from web.services.collect_sync import parallel_util
from web.services.collect_sync.exceptions import CollectCancelled


def _merge_monitor_services(snapshot, new_items: list, *, snap_lock=None) -> None:
    if snap_lock is not None:
        with snap_lock:
            kept = [s for s in snapshot.services if str(getattr(s, "kind", "")).lower() not in MONITOR_KINDS]
            snapshot.services = kept + list(new_items)
    else:
        kept = [s for s in snapshot.services if str(getattr(s, "kind", "")).lower() not in MONITOR_KINDS]
        snapshot.services = kept + list(new_items)


def collect_external_service_monitors(
    *,
    cfg: dict,
    snapshot,
    progress,
    health: list,
    health_lock: Lock | None = None,
    logger,
    check_cancelled,
    snap_lock=None,
    maybe_save_partial=None,
    touch_live_snapshot=None,
) -> None:
    """Poll configured external monitoring systems and merge into snapshot.services."""
    if not service_monitors_enabled(cfg):
        return

    def _append_health(item: dict) -> None:
        if health_lock is not None:
            with health_lock:
                health.append(item)
        else:
            health.append(item)

    sm_cfg = cfg.get("service_monitors") or {}
    instances = [
        inst
        for inst in (sm_cfg.get("instances") or [])
        if (
            isinstance(inst, dict)
            and inst.get("enabled", True)
            and str(inst.get("type") or "").strip()
            and _instance_configured(inst)
        )
    ]
    if not instances:
        return

    t0 = time.monotonic()
    try:
        progress("service_monitors", "Service monitors", f"Polling {len(instances)} source(s)…")
        check_cancelled()

        all_items: list = []
        items_lock = Lock()

        def _publish() -> None:
            _merge_monitor_services(snapshot, all_items, snap_lock=snap_lock)
            if maybe_save_partial is not None:
                try:
                    maybe_save_partial(snapshot)
                except Exception:
                    pass
            if touch_live_snapshot is not None:
                try:
                    touch_live_snapshot()
                except Exception:
                    pass

        def _check_one(inst: dict) -> None:
            check_cancelled()
            from service_monitors.runner import collect_instance

            label = str(inst.get("name") or inst.get("type") or "monitor")
            logger.info("Service monitor check started: %s (%s)", label, inst.get("type"))
            timeout = int(sm_cfg.get("timeout_seconds") or 15)
            chunk = collect_instance(inst, timeout=timeout)
            check_cancelled()
            if chunk:
                with items_lock:
                    all_items.extend(chunk)
                _publish()

        parallel_util.run_parallel_items(
            instances,
            _check_one,
            parallel=parallel_util.parallel_instances_enabled(cfg),
            max_workers=parallel_util.instance_worker_cap(cfg, len(instances)),
            thread_prefix="svc-mon",
        )

        if not all_items:
            _publish()

        logger.info("Service monitors completed: instances=%d, services=%d", len(instances), len(all_items))
        _append_health(
            {
                "name": "Service monitors",
                "kind": "service_monitors",
                "ok": True,
                "error": None,
                "latency_ms": int((time.monotonic() - t0) * 1000),
            }
        )
    except CollectCancelled:
        raise
    except Exception as exc:
        logger.error("Service monitors failed: %s", exc)
        _append_health(
            {
                "name": "Service monitors",
                "kind": "service_monitors",
                "ok": False,
                "error": str(exc),
                "latency_ms": None,
            }
        )
