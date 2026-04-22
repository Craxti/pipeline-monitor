"""Thin FastAPI endpoints for fetching/diffing logs."""

from __future__ import annotations

import logging
from typing import Any, Callable

from fastapi import HTTPException, Request

logger = logging.getLogger(__name__)


async def api_logs_jenkins(
    request: Request,
    *,
    job_name: str,
    build_number: int,
    instance_url: str,
    rid: str,
    check_rate_limit: Callable[..., None],
    load_cfg: Callable[[], dict],
    fetch_jenkins_log: Callable[..., Any],
) -> Any:
    """Fetch Jenkins console log for a job/build."""
    if not job_name.strip() or build_number < 1:
        raise HTTPException(400, "job_name and build_number are required")
    check_rate_limit(f"log:jenkins:{job_name}:{build_number}", window=2)
    logger.info("[%s] GET jenkins log %s #%s", rid, job_name, build_number)
    cfg = load_cfg()
    return fetch_jenkins_log(
        cfg=cfg,
        job_name=job_name,
        build_number=build_number,
        instance_url=instance_url,
    )


async def api_logs_gitlab(
    request: Request,
    *,
    project_id: str,
    pipeline_id: int,
    instance_url: str,
    rid: str,
    check_rate_limit: Callable[..., None],
    load_cfg: Callable[[], dict],
    fetch_gitlab_log: Callable[..., Any],
) -> Any:
    """Fetch GitLab job log for a project pipeline."""
    if not project_id.strip() or pipeline_id < 1:
        raise HTTPException(400, "project_id and pipeline_id are required")
    check_rate_limit(f"log:gitlab:{project_id}:{pipeline_id}", window=2)
    logger.info("[%s] GET gitlab log %s pipeline %s", rid, project_id, pipeline_id)
    cfg = load_cfg()
    return fetch_gitlab_log(
        cfg=cfg,
        project_id=project_id,
        pipeline_id=pipeline_id,
        instance_url=instance_url,
    )


async def api_logs_diff(
    *,
    source: str,
    job_name: str,
    build_number: int,
    instance_url: str,
    check_rate_limit: Callable[..., None],
    load_cfg: Callable[[], dict],
    load_snapshot: Callable[[], Any],
    diff_logs: Callable[..., Any],
) -> Any:
    """Return a unified diff between relevant logs."""
    logger.info(
        "GET logs diff requested source=%s job=%s build=%s instance_url=%s",
        source,
        job_name,
        build_number,
        instance_url or "default",
    )
    check_rate_limit(f"diff:{source}:{job_name}:{build_number}", window=5)
    cfg = load_cfg()
    snap = load_snapshot()
    try:
        result = diff_logs(
            source=source,
            job_name=job_name,
            build_number=build_number,
            instance_url=instance_url,
            cfg=cfg,
            snapshot=snap,
        )
        logger.info(
            "GET logs diff completed source=%s job=%s build=%s reference=%s",
            source,
            job_name,
            build_number,
            result.get("reference_build"),
        )
        return result
    except HTTPException as exc:
        logger.warning(
            "GET logs diff failed source=%s job=%s build=%s status=%s detail=%s",
            source,
            job_name,
            build_number,
            exc.status_code,
            exc.detail,
        )
        raise
    except Exception as exc:
        logger.exception(
            "GET logs diff unexpected error source=%s job=%s build=%s: %s",
            source,
            job_name,
            build_number,
            exc,
        )
        raise HTTPException(500, f"Internal error while diffing logs: {exc}") from exc


async def api_pipeline_stages(
    *,
    project_id: str,
    pipeline_id: int,
    instance_url: str,
    check_rate_limit: Callable[..., None],
    load_cfg: Callable[[], dict],
    pipeline_stages: Callable[..., Any],
) -> Any:
    """Fetch GitLab pipeline stages info."""
    if not project_id.strip() or pipeline_id < 1:
        raise HTTPException(400, "project_id and pipeline_id are required")
    check_rate_limit(f"stages:{project_id}:{pipeline_id}", window=2)
    cfg = load_cfg()
    return pipeline_stages(
        cfg=cfg,
        project_id=project_id,
        pipeline_id=pipeline_id,
        instance_url=instance_url,
    )


async def api_logs_docker(
    *,
    container: str,
    docker_host: str,
    tail: int,
    check_rate_limit: Callable[..., None],
    load_cfg: Callable[[], dict],
    docker_logs_tail: Callable[..., Any],
) -> Any:
    """Return recent docker logs for a container."""
    container = container.strip()
    if not container:
        raise HTTPException(400, "container is required")
    check_rate_limit(f"log:docker:{container}", window=2)
    try:
        cfg = load_cfg()
        return docker_logs_tail(cfg=cfg, container=container, tail=tail, docker_host=docker_host)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        logger.error("Docker logs failed: %s", exc)
        raise HTTPException(500, f"Failed to read logs: {exc}") from exc


async def api_logs_docker_stream(
    *,
    container: str,
    docker_host: str,
    follow: bool,
    tail: int,
    check_rate_limit: Callable[..., None],
    load_cfg: Callable[[], dict],
    docker_logs_stream_response: Callable[..., Any],
) -> Any:
    """Stream docker logs for a container."""
    container = container.strip()
    if not container:
        raise HTTPException(400, "container is required")
    host_key = (docker_host or "local").strip() or "local"
    mode = "follow" if follow else "tail"
    # Keep light abuse protection but avoid false positives when the UI does
    # a buffered tail load and then quickly switches to live follow mode.
    window = 0.75 if follow else 0.15
    check_rate_limit(f"log:docker:stream:{mode}:{host_key}:{container}", window=window)
    cfg = load_cfg()
    return docker_logs_stream_response(cfg=cfg, container=container, follow=follow, tail=tail, docker_host=docker_host)
