"""Routes for per-container log intelligence (clustering, correlation, anomalies)."""

from __future__ import annotations

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from web.core import runtime as rt
from web.core.config import load_yaml_config
from web.services import log_intel_endpoints

router = APIRouter(tags=["log-intel"])


@router.get("/api/log-intel/containers", response_class=JSONResponse)
async def api_log_intel_containers():
    return log_intel_endpoints.api_list_containers(load_snapshot=rt.load_snapshot)


@router.get("/api/log-intel/containers/{key:path}", response_class=JSONResponse)
async def api_log_intel_container(key: str):
    return log_intel_endpoints.api_container_detail(key)


@router.post("/api/log-intel/containers/{key:path}/watch", response_class=JSONResponse)
async def api_log_intel_watch(key: str, body: dict = Body(default_factory=dict)):
    watched = bool(body.get("watch"))
    return log_intel_endpoints.api_set_watch(key=key, watched=watched)


@router.post("/api/log-intel/containers/{key:path}/train", response_class=JSONResponse)
async def api_log_intel_train(key: str, tail: int = 3000):
    return log_intel_endpoints.api_train_container(
        key=key,
        load_cfg=load_yaml_config,
        tail=tail,
    )
