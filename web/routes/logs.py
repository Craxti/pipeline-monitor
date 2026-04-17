"""Log viewer endpoints (Jenkins / GitLab / Docker) and pipeline stages."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from web.core.auth import require_shared_token
from web.core.config import load_yaml_config
from web.core import runtime as rt
from web.services import logs_endpoints, logs_api, request_id, runtime_helpers


router = APIRouter(tags=["logs"])


def _check_rate_limit(key: str, window: float = 15) -> None:
    return runtime_helpers.check_rate_limit(rt.rate_limit_rt.store, key, window=window)


@router.get(
    "/api/logs/jenkins",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def api_logs_jenkins(
    request: Request,
    job_name: str,
    build_number: int,
    instance_url: str = "",
):
    """Return Jenkins console log (tail)."""
    return await logs_endpoints.api_logs_jenkins(
        request,
        job_name=job_name,
        build_number=build_number,
        instance_url=instance_url,
        rid=request_id.rid(request),
        check_rate_limit=_check_rate_limit,
        load_cfg=load_yaml_config,
        fetch_jenkins_log=logs_api.fetch_jenkins_log,
    )


@router.get(
    "/api/logs/gitlab",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def api_logs_gitlab(
    request: Request,
    project_id: str,
    pipeline_id: int,
    instance_url: str = "",
):
    """Return GitLab job log (tail)."""
    return await logs_endpoints.api_logs_gitlab(
        request,
        project_id=project_id,
        pipeline_id=pipeline_id,
        instance_url=instance_url,
        rid=request_id.rid(request),
        check_rate_limit=_check_rate_limit,
        load_cfg=load_yaml_config,
        fetch_gitlab_log=logs_api.fetch_gitlab_log,
    )


@router.get(
    "/api/logs/diff",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def api_logs_diff(source: str, job_name: str, build_number: int, instance_url: str = ""):
    """Return diff between two recent logs."""
    return await logs_endpoints.api_logs_diff(
        source=source,
        job_name=job_name,
        build_number=build_number,
        instance_url=instance_url,
        check_rate_limit=_check_rate_limit,
        load_cfg=load_yaml_config,
        load_snapshot=rt.load_snapshot,
        diff_logs=logs_api.diff_logs,
    )


@router.get("/api/pipeline/stages", response_class=JSONResponse)
async def api_pipeline_stages(project_id: str, pipeline_id: int, instance_url: str = ""):
    """Return pipeline stages for GitLab pipeline."""
    return await logs_endpoints.api_pipeline_stages(
        project_id=project_id,
        pipeline_id=pipeline_id,
        instance_url=instance_url,
        check_rate_limit=_check_rate_limit,
        load_cfg=load_yaml_config,
        pipeline_stages=logs_api.pipeline_stages,
    )


@router.get(
    "/api/logs/docker",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def api_logs_docker(container: str, tail: int = 4000):
    """Return docker logs tail."""
    return await logs_endpoints.api_logs_docker(
        container=container,
        tail=tail,
        check_rate_limit=_check_rate_limit,
        docker_logs_tail=logs_api.docker_logs_tail,
    )


@router.get(
    "/api/logs/docker/stream",
    dependencies=[Depends(require_shared_token)],
)
async def api_logs_docker_stream(container: str):
    """Stream docker logs via SSE/streaming response."""
    return await logs_endpoints.api_logs_docker_stream(
        container=container,
        check_rate_limit=_check_rate_limit,
        docker_logs_stream_response=logs_api.docker_logs_stream_response,
    )
