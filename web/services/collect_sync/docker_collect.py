from __future__ import annotations

import time


def collect_docker_services(*, cfg: dict, snapshot, progress, health: list, logger) -> None:
    from docker_monitor.monitor import DockerMonitor

    dm_cfg = cfg.get("docker_monitor", {})
    if not dm_cfg.get("enabled"):
        return
    t0 = time.monotonic()
    try:
        progress("docker", "Docker / HTTP", "Running checks…")
        monitor = DockerMonitor(
            containers=dm_cfg.get("containers", []),
            http_checks=dm_cfg.get("http_checks", []),
            timeout=dm_cfg.get("timeout_seconds", 5),
            show_all=dm_cfg.get("show_all_containers", False),
        )
        snapshot.services = monitor.check_all()
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

