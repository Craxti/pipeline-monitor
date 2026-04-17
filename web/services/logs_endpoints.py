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
    if not job_name.strip() or build_number < 1:
        raise HTTPException(400, "job_name and build_number are required")
    check_rate_limit(f"log:jenkins:{job_name}:{build_number}", window=2)
    logger.info("[%s] GET jenkins log %s #%s", rid, job_name, build_number)
    cfg = load_cfg()
    return fetch_jenkins_log(cfg=cfg, job_name=job_name, build_number=build_number, instance_url=instance_url)


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
    if not project_id.strip() or pipeline_id < 1:
        raise HTTPException(400, "project_id and pipeline_id are required")
    check_rate_limit(f"log:gitlab:{project_id}:{pipeline_id}", window=2)
    logger.info("[%s] GET gitlab log %s pipeline %s", rid, project_id, pipeline_id)
    cfg = load_cfg()
    return fetch_gitlab_log(cfg=cfg, project_id=project_id, pipeline_id=pipeline_id, instance_url=instance_url)


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
    check_rate_limit(f"diff:{source}:{job_name}:{build_number}", window=5)
    cfg = load_cfg()
    snap = load_snapshot()
    return diff_logs(
        source=source,
        job_name=job_name,
        build_number=build_number,
        instance_url=instance_url,
        cfg=cfg,
        snapshot=snap,
    )


async def api_pipeline_stages(
    *,
    project_id: str,
    pipeline_id: int,
    instance_url: str,
    check_rate_limit: Callable[..., None],
    load_cfg: Callable[[], dict],
    pipeline_stages: Callable[..., Any],
) -> Any:
    if not project_id.strip() or pipeline_id < 1:
        raise HTTPException(400, "project_id and pipeline_id are required")
    check_rate_limit(f"stages:{project_id}:{pipeline_id}", window=2)
    cfg = load_cfg()
    return pipeline_stages(cfg=cfg, project_id=project_id, pipeline_id=pipeline_id, instance_url=instance_url)


async def api_logs_docker(
    *,
    container: str,
    tail: int,
    check_rate_limit: Callable[..., None],
    docker_logs_tail: Callable[..., Any],
) -> Any:
    container = container.strip()
    if not container:
        raise HTTPException(400, "container is required")
    check_rate_limit(f"log:docker:{container}", window=2)
    try:
        return docker_logs_tail(container=container, tail=tail)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        logger.error("Docker logs failed: %s", exc)
        raise HTTPException(500, f"Failed to read logs: {exc}") from exc


async def api_logs_docker_stream(
    *,
    container: str,
    check_rate_limit: Callable[..., None],
    docker_logs_stream_response: Callable[..., Any],
) -> Any:
    container = container.strip()
    if not container:
        raise HTTPException(400, "container is required")
    check_rate_limit(f"log:docker:stream:{container}", window=3)
    return docker_logs_stream_response(container=container)

