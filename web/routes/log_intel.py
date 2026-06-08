"""Routes for service analysis (clustering, correlation, incidents)."""

from __future__ import annotations

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from web.core import runtime as rt
from web.core.config import load_yaml_config
from web.services import log_intel_endpoints

router = APIRouter(tags=["service-intel"])


@router.get("/api/service-intel/models", response_class=JSONResponse)
@router.get("/api/service-intel/services", response_class=JSONResponse)
@router.get("/api/log-intel/containers", response_class=JSONResponse)
async def api_service_intel_list():
    return log_intel_endpoints.api_list_models(load_snapshot=rt.load_snapshot)


@router.get("/api/service-intel/candidates", response_class=JSONResponse)
async def api_service_intel_candidates():
    return log_intel_endpoints.api_list_candidates(
        load_snapshot=rt.load_snapshot,
        load_cfg=load_yaml_config,
    )


@router.post("/api/service-intel/models", response_class=JSONResponse)
async def api_service_intel_create(body: dict = Body(default_factory=dict)):
    return log_intel_endpoints.api_create_model(
        body=body,
        load_snapshot=rt.load_snapshot,
        load_cfg=load_yaml_config,
    )


@router.patch("/api/service-intel/models/{model_id:int}", response_class=JSONResponse)
async def api_service_intel_update(model_id: int, body: dict = Body(default_factory=dict)):
    return log_intel_endpoints.api_update_model(model_id=model_id, body=body)


@router.delete("/api/service-intel/models/{model_id:int}", response_class=JSONResponse)
async def api_service_intel_delete(model_id: int):
    return log_intel_endpoints.api_delete_model(model_id=model_id)


@router.get("/api/service-intel/models/{model_id:int}", response_class=JSONResponse)
async def api_service_intel_model_detail(model_id: int):
    return log_intel_endpoints.api_model_detail(model_id=model_id)


@router.get("/api/service-intel/models/by-key/{key:path}", response_class=JSONResponse)
async def api_service_intel_model_by_key(key: str):
    return log_intel_endpoints.api_model_detail_by_key(key)


@router.post("/api/service-intel/models/{model_id:int}/train", response_class=JSONResponse)
async def api_service_intel_model_train(model_id: int, tail: int = 3000):
    return log_intel_endpoints.api_train_model(
        model_id=model_id,
        load_cfg=load_yaml_config,
        tail=tail,
    )


@router.get("/api/service-intel/services/{key:path}", response_class=JSONResponse)
@router.get("/api/log-intel/containers/{key:path}", response_class=JSONResponse)
async def api_service_intel_detail(key: str):
    return log_intel_endpoints.api_service_detail(key)


@router.post("/api/service-intel/services/{key:path}/watch", response_class=JSONResponse)
@router.post("/api/log-intel/containers/{key:path}/watch", response_class=JSONResponse)
async def api_service_intel_watch(key: str, body: dict = Body(default_factory=dict)):
    watched = bool(body.get("watch"))
    return log_intel_endpoints.api_set_watch(key=key, watched=watched)


@router.post("/api/service-intel/services/{key:path}/train", response_class=JSONResponse)
@router.post("/api/log-intel/containers/{key:path}/train", response_class=JSONResponse)
async def api_service_intel_train(key: str, tail: int = 3000):
    return log_intel_endpoints.api_train_service(
        key=key,
        load_cfg=load_yaml_config,
        tail=tail,
    )
