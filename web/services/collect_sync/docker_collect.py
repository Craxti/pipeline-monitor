"""Docker/HTTP collectors used by the sync collection runner."""

from __future__ import annotations

import time


def collect_docker_services(*, cfg: dict, snapshot, progress, health: list, logger) -> None:
    """Collect container/service status via Docker monitor."""
    from docker_monitor.monitor import DockerMonitor

    dm_cfg = cfg.get("docker_monitor", {})
    if not dm_cfg.get("enabled"):
        return
    t0 = time.monotonic()
    try:
        progress("docker", "Docker / HTTP", "Running checks…")
        hosts = []
        if dm_cfg.get("include_local_host", True):
            hosts.append({"name": "local", "host": "local", "enabled": True})
        for h in dm_cfg.get("docker_hosts", []) or []:
            if isinstance(h, dict) and h.get("enabled", True):
                hosts.append(h)

        all_services = []
        for h in hosts:
            logger.info("Docker monitor host check started: %s", h.get("name") or h.get("host") or "unknown")
            monitor = DockerMonitor(
                containers=dm_cfg.get("containers", []),
                http_checks=[],
                timeout=dm_cfg.get("timeout_seconds", 5),
                show_all=dm_cfg.get("show_all_containers", False),
                docker_host=h,
            )
            all_services.extend(monitor.check_all())

        # HTTP checks are collected once (not tied to Docker daemon hosts).
        http_monitor = DockerMonitor(
            containers=[],
            http_checks=dm_cfg.get("http_checks", []),
            timeout=dm_cfg.get("timeout_seconds", 5),
            show_all=False,
            docker_host={"name": "local", "host": "local"},
        )
        all_services.extend(http_monitor._check_http())
        snapshot.services = all_services
        logger.info(
            "Docker monitor completed: hosts=%d, http_checks=%d, services=%d",
            len(hosts),
            len(dm_cfg.get("http_checks", []) or []),
            len(all_services),
        )
        health.append(
            {
                "name": "Docker monitor",
                "kind": "docker",
                "ok": True,
                "error": None,
                "latency_ms": int((time.monotonic() - t0) * 1000),
            }
        )
    except Exception as exc:
        logger.error("Docker monitor failed: %s", exc)
        health.append(
            {
                "name": "Docker monitor",
                "kind": "docker",
                "ok": False,
                "error": str(exc),
                "latency_ms": None,
            }
        )
