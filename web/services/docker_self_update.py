"""Background docker self-update loop for this project."""

from __future__ import annotations

import asyncio
import logging
import subprocess
from pathlib import Path

_DEFAULT_ENABLED = False
_DEFAULT_INTERVAL_SECONDS = 300
_DEFAULT_IMAGE = "ghcr.io/craxti/pipeline-monitor:latest"
_DEFAULT_SERVICE = "pipeline-monitor-web"
_DEFAULT_CONTAINER = "pipeline-monitor-web"
_DEFAULT_COMPOSE_FILE = "compose.yml"


def _run_cmd(args: list[str], *, timeout: int = 120) -> tuple[int, str]:
    try:
        cp = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except Exception as exc:
        return 1, str(exc)
    out = (cp.stdout or "").strip()
    err = (cp.stderr or "").strip()
    msg = out if out else err
    return cp.returncode, msg


def _compose_path_from_cfg(cfg: dict) -> Path:
    web_cfg = cfg.get("web", {}) if isinstance(cfg.get("web"), dict) else {}
    rel = str(web_cfg.get("docker_auto_update_compose_file") or _DEFAULT_COMPOSE_FILE).strip()
    base = Path(__file__).resolve().parents[2]
    p = (base / rel).resolve()
    return p


def _update_once(cfg: dict, logger: logging.Logger) -> None:
    web_cfg = cfg.get("web", {}) if isinstance(cfg.get("web"), dict) else {}
    service = str(web_cfg.get("docker_auto_update_service") or _DEFAULT_SERVICE).strip()
    container = str(web_cfg.get("docker_auto_update_container") or _DEFAULT_CONTAINER).strip()
    image = str(web_cfg.get("docker_auto_update_image") or _DEFAULT_IMAGE).strip()
    compose_file = _compose_path_from_cfg(cfg)

    if not service or not container:
        logger.warning("docker auto-update skipped: empty service/container")
        return
    if not compose_file.is_file():
        logger.warning("docker auto-update skipped: compose file not found: %s", compose_file)
        return

    old_rc, old_id = _run_cmd(["docker", "inspect", "--format", "{{.Image}}", container], timeout=30)
    if old_rc != 0:
        logger.info("docker auto-update: container '%s' is not inspectable (%s)", container, old_id or "unknown")

    pull_rc, pull_msg = _run_cmd(
        ["docker", "compose", "-f", str(compose_file), "pull", service],
        timeout=900,
    )
    if pull_rc != 0:
        logger.warning("docker auto-update pull failed for %s: %s", service, pull_msg or "unknown error")
        return

    new_rc, new_id = _run_cmd(["docker", "compose", "-f", str(compose_file), "images", "-q", service], timeout=30)
    if new_rc != 0 or not new_id:
        logger.warning("docker auto-update: could not resolve image id for service %s (%s)", service, new_id or "")
        return

    if old_id and old_id == new_id:
        logger.debug("docker auto-update: no new image for %s (%s)", service, image)
        return

    up_rc, up_msg = _run_cmd(
        ["docker", "compose", "-f", str(compose_file), "up", "-d", "--no-deps", service],
        timeout=900,
    )
    if up_rc != 0:
        logger.error("docker auto-update apply failed for %s: %s", service, up_msg or "unknown error")
        return

    logger.info(
        "docker auto-update applied for service=%s image=%s old_image_id=%s new_image_id=%s",
        service,
        image,
        old_id or "n/a",
        new_id,
    )


class DockerSelfUpdateLoop:
    """Owns a single background task that checks for updated docker image."""

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    def start(self, *, load_cfg, logger: logging.Logger) -> None:
        if self._task and not self._task.done():
            return
        self._stop = asyncio.Event()
        self._task = asyncio.create_task(self._run(load_cfg=load_cfg, logger=logger))

    async def stop(self) -> None:
        self._stop.set()
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None

    async def _run(self, *, load_cfg, logger: logging.Logger) -> None:
        while not self._stop.is_set():
            interval = _DEFAULT_INTERVAL_SECONDS
            try:
                cfg = load_cfg()
                web_cfg = cfg.get("web", {}) if isinstance(cfg.get("web"), dict) else {}
                enabled = bool(web_cfg.get("docker_auto_update_enabled", _DEFAULT_ENABLED))
                interval = int(
                    web_cfg.get("docker_auto_update_check_interval_seconds", _DEFAULT_INTERVAL_SECONDS)
                    or _DEFAULT_INTERVAL_SECONDS
                )
                interval = max(60, min(86400, interval))
                if enabled:
                    await asyncio.to_thread(_update_once, cfg, logger)
            except Exception:
                logger.exception("docker auto-update loop error")

            try:
                await asyncio.wait_for(self._stop.wait(), timeout=interval)
            except asyncio.TimeoutError:
                continue
