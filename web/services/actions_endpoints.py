from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable

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
    body = await request.json()
    job_name = body.get("job_name", "")
    instance_url = body.get("instance_url", "")
    if not job_name:
        raise HTTPException(400, "job_name is required")
    check_rate_limit(f"jenkins:{job_name}")
    logger.info("[%s] action jenkins build job=%s", rid, job_name)
    try:
        cfg = load_cfg()
        return trigger_jenkins_build(cfg=cfg, job_name=job_name, instance_url=instance_url)
    except Exception as exc:
        logger.error("Jenkins trigger failed: %s", exc)
        raise HTTPException(500, f"Failed to trigger build: {exc}")


async def action_gitlab_pipeline(
    request: Request,
    *,
    rid: str,
    check_rate_limit: Callable[..., None],
    load_cfg: Callable[[], dict],
    trigger_gitlab_pipeline: Callable[..., Any],
) -> Any:
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
        return trigger_gitlab_pipeline(cfg=cfg, project_id=project_id, ref=ref, instance_url=instance_url)
    except Exception as exc:
        logger.error("GitLab trigger failed: %s", exc)
        raise HTTPException(500, f"Failed to trigger pipeline: {exc}")


async def action_docker_container(
    request: Request,
    *,
    rid: str,
    check_rate_limit: Callable[..., None],
    docker_container_action: Callable[..., Any],
) -> Any:
    body = await request.json()
    container_name = body.get("container_name", "")
    action = (body.get("action") or "restart").lower().strip()
    if not container_name:
        raise HTTPException(400, "container_name is required")
    if action not in ("start", "stop", "restart"):
        raise HTTPException(400, "action must be one of: start, stop, restart")
    check_rate_limit(f"docker:{container_name}:{action}", window=5)
    logger.info("[%s] action docker %s %s", rid, action, container_name)
    try:
        return docker_container_action(container_name=container_name, action=action)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        logger.error("Docker %s failed: %s", action, exc)
        raise HTTPException(500, f"Failed to {action} container: {exc}") from exc


async def action_docker_restart(
    request: Request,
    *,
    docker_container_action: Callable[..., Any],
) -> Any:
    body = await request.json()
    container_name = body.get("container_name", "")
    if not container_name:
        raise HTTPException(400, "container_name is required")
    try:
        return docker_container_action(container_name=container_name, action="restart")
    except Exception as exc:
        logger.error("Docker restart failed: %s", exc)
        raise HTTPException(500, f"Failed to restart container: {exc}") from exc

