"""Docker/HTTP collectors used by the sync collection runner."""

from __future__ import annotations

import time
from threading import Lock

from web.services.collect_sync import parallel_util
from web.services.collect_sync.exceptions import CollectCancelled


def collect_docker_services(
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
) -> None:
    """Collect container/service status via Docker monitor (parallel per host)."""
    from docker_monitor.monitor import DockerMonitor

    dm_cfg = cfg.get("docker_monitor", {})
    if not dm_cfg.get("enabled"):
        return

    def _append_health(item: dict) -> None:
        if health_lock is not None:
            with health_lock:
                health.append(item)
        else:
            health.append(item)

    t0 = time.monotonic()
    try:
        progress("docker", "Docker / HTTP", "Running checks…")
        check_cancelled()
        hosts = []
        if dm_cfg.get("include_local_host", True):
            hosts.append({"name": "local", "host": "local", "enabled": True})
        for h in dm_cfg.get("docker_hosts", []) or []:
            if isinstance(h, dict) and h.get("enabled", True):
                hosts.append(h)

        all_services: list = []
        services_lock = Lock()

        def _check_host(h: dict) -> None:
            check_cancelled()
            logger.info("Docker monitor host check started: %s", h.get("name") or h.get("host") or "unknown")
            monitor = DockerMonitor(
                containers=dm_cfg.get("containers", []),
                http_checks=[],
                timeout=dm_cfg.get("timeout_seconds", 5),
                show_all=dm_cfg.get("show_all_containers", False),
                docker_host=h,
            )
            chunk = monitor.check_all()
            check_cancelled()
            if chunk:
                with services_lock:
                    all_services.extend(chunk)

        parallel_util.run_parallel_items(
            hosts,
            _check_host,
            parallel=parallel_util.parallel_instances_enabled(cfg),
            max_workers=parallel_util.instance_worker_cap(cfg, len(hosts)),
            thread_prefix="docker-host",
        )

        http_monitor = DockerMonitor(
            containers=[],
            http_checks=dm_cfg.get("http_checks", []),
            timeout=dm_cfg.get("timeout_seconds", 5),
            show_all=False,
            docker_host={"name": "local", "host": "local"},
        )
        all_services.extend(http_monitor._check_http())
        check_cancelled()
        if snap_lock is not None:
            with snap_lock:
                snapshot.services = all_services
        else:
            snapshot.services = all_services
        if maybe_save_partial is not None:
            try:
                maybe_save_partial(snapshot)
            except Exception:
                pass
        logger.info(
            "Docker monitor completed: hosts=%d, http_checks=%d, services=%d",
            len(hosts),
            len(dm_cfg.get("http_checks", []) or []),
            len(all_services),
        )
        _append_health(
            {
                "name": "Docker monitor",
                "kind": "docker",
                "ok": True,
                "error": None,
                "latency_ms": int((time.monotonic() - t0) * 1000),
            }
        )
    except CollectCancelled:
        raise
    except Exception as exc:
        logger.error("Docker monitor failed: %s", exc)
        _append_health(
            {
                "name": "Docker monitor",
                "kind": "docker",
                "ok": False,
                "error": str(exc),
                "latency_ms": None,
            }
        )
