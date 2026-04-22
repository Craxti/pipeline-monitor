"""Action endpoints implementations (Jenkins/GitLab/Docker)."""

from __future__ import annotations

import logging
from typing import Any, Callable

from fastapi import HTTPException, Request

logger = logging.getLogger(__name__)


async def action_jenkins_build(
    request: Request,
    *,
    rid: str,
    check_rate_limit: Callable[..., None],
    load_cfg: Callable[[], dict],
    trigger_jenkins_build: Callable[..., Any],
) -> Any:
    """Trigger Jenkins build action."""
    body = await request.json()
    job_name = body.get("job_name", "")
    instance_url = body.get("instance_url", "")
    client_host = getattr(request.client, "host", "-")
    if not job_name:
        raise HTTPException(400, "job_name is required")
    check_rate_limit(f"jenkins:{job_name}")
    logger.info(
        "[%s] action jenkins build requested host=%s job=%s instance_url=%s",
        rid,
        client_host,
        job_name,
        instance_url or "default",
    )
    try:
        cfg = load_cfg()
        result = trigger_jenkins_build(cfg=cfg, job_name=job_name, instance_url=instance_url)
        logger.info("[%s] action jenkins build completed job=%s result=%s", rid, job_name, result)
        return result
    except Exception as exc:
        logger.exception("[%s] Jenkins trigger failed job=%s: %s", rid, job_name, exc)
        raise HTTPException(500, f"Failed to trigger build: {exc}") from exc


async def action_gitlab_pipeline(
    request: Request,
    *,
    rid: str,
    check_rate_limit: Callable[..., None],
    load_cfg: Callable[[], dict],
    trigger_gitlab_pipeline: Callable[..., Any],
) -> Any:
    """Trigger GitLab pipeline action."""
    body = await request.json()
    project_id = body.get("project_id", "")
    ref = body.get("ref", "main")
    instance_url = body.get("instance_url", "")
    if not project_id:
        raise HTTPException(400, "project_id is required")
    check_rate_limit(f"gitlab:{project_id}:{ref}")
    logger.info("[%s] action gitlab pipeline project=%s ref=%s", rid, project_id, ref)
    try:
        cfg = load_cfg()
        return trigger_gitlab_pipeline(
            cfg=cfg,
            project_id=project_id,
            ref=ref,
            instance_url=instance_url,
        )
    except Exception as exc:
        logger.error("GitLab trigger failed: %s", exc)
        raise HTTPException(500, f"Failed to trigger pipeline: {exc}") from exc


async def action_docker_container(
    request: Request,
    *,
    rid: str,
    check_rate_limit: Callable[..., None],
    load_cfg: Callable[[], dict],
    docker_container_action: Callable[..., Any],
) -> Any:
    """Execute docker container action (start/stop/restart)."""
    body = await request.json()
    container_name = body.get("container_name", "")
    docker_host = body.get("docker_host", "")
    action = (body.get("action") or "restart").lower().strip()
    client_host = getattr(request.client, "host", "-")
    if not container_name:
        raise HTTPException(400, "container_name is required")
    if action not in ("start", "stop", "restart"):
        raise HTTPException(400, "action must be one of: start, stop, restart")
    check_rate_limit(f"docker:{container_name}:{action}", window=5)
    logger.info(
        "[%s] action docker requested host=%s action=%s container=%s docker_host=%s",
        rid,
        client_host,
        action,
        container_name,
        docker_host or "local",
    )
    try:
        cfg = load_cfg()
        result = docker_container_action(cfg=cfg, container_name=container_name, action=action, docker_host=docker_host)
        logger.info(
            "[%s] action docker completed action=%s container=%s result=%s",
            rid,
            action,
            container_name,
            result,
        )
        return result
    except ValueError as exc:
        logger.warning("[%s] Docker action rejected action=%s container=%s: %s", rid, action, container_name, exc)
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        logger.exception("[%s] Docker %s failed container=%s: %s", rid, action, container_name, exc)
        msg = str(exc)
        if "No such file or directory" in msg or "Error while fetching server API version" in msg:
            msg += (
                " (Docker daemon not reachable. In container mode mount /var/run/docker.sock "
                "and ensure Docker is running on the host.)"
            )
        raise HTTPException(500, f"Failed to {action} container: {msg}") from exc


async def action_docker_restart(
    request: Request,
    *,
    load_cfg: Callable[[], dict],
    docker_container_action: Callable[..., Any],
) -> Any:
    """Restart docker container (shortcut action)."""
    body = await request.json()
    container_name = body.get("container_name", "")
    docker_host = body.get("docker_host", "")
    client_host = getattr(request.client, "host", "-")
    if not container_name:
        raise HTTPException(400, "container_name is required")
    logger.info(
        "action docker restart requested host=%s container=%s docker_host=%s",
        client_host,
        container_name,
        docker_host or "local",
    )
    try:
        cfg = load_cfg()
        result = docker_container_action(
            cfg=cfg, container_name=container_name, action="restart", docker_host=docker_host
        )
        logger.info("action docker restart completed container=%s result=%s", container_name, result)
        return result
    except Exception as exc:
        logger.exception("Docker restart failed container=%s: %s", container_name, exc)
        raise HTTPException(500, f"Failed to restart container: {exc}") from exc
