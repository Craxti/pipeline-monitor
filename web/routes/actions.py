"""Action endpoints (trigger CI builds / Docker actions)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from web.core import runtime as rt
from web.core.auth import require_shared_token
from web.core.config import load_yaml_config
from web.services import actions_endpoints, ops_actions, request_id, runtime_helpers

router = APIRouter(tags=["actions"])


def _check_rate_limit(key: str, window: float = 15) -> None:
    return runtime_helpers.check_rate_limit(rt.rate_limit_rt.store, key, window=window)


@router.post(
    "/api/action/jenkins/build",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def action_jenkins_build(request: Request):
    """Trigger Jenkins build."""
    return await actions_endpoints.action_jenkins_build(
        request,
        rid=request_id.rid(request),
        check_rate_limit=_check_rate_limit,
        load_cfg=load_yaml_config,
        trigger_jenkins_build=ops_actions.trigger_jenkins_build,
    )


@router.post(
    "/api/action/gitlab/pipeline",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def action_gitlab_pipeline(request: Request):
    """Trigger GitLab pipeline."""
    return await actions_endpoints.action_gitlab_pipeline(
        request,
        rid=request_id.rid(request),
        check_rate_limit=_check_rate_limit,
        load_cfg=load_yaml_config,
        trigger_gitlab_pipeline=ops_actions.trigger_gitlab_pipeline,
    )


@router.post(
    "/api/action/docker/container",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def action_docker_container(request: Request):
    """Execute docker action on a container."""
    return await actions_endpoints.action_docker_container(
        request,
        rid=request_id.rid(request),
        check_rate_limit=_check_rate_limit,
        load_cfg=load_yaml_config,
        docker_container_action=ops_actions.docker_container_action,
    )


@router.post(
    "/api/action/docker/restart",
    response_class=JSONResponse,
    dependencies=[Depends(require_shared_token)],
)
async def action_docker_restart(request: Request):
    """Restart a docker container (shortcut action)."""
    return await actions_endpoints.action_docker_restart(
        request,
        load_cfg=load_yaml_config,
        docker_container_action=ops_actions.docker_container_action,
    )
