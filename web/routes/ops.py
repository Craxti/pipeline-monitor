"""Liveness / readiness probes."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException

from web.schemas import HealthResponse, ReadyResponse

router = APIRouter(tags=["ops"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    import web.app as web_app

    return HealthResponse(
        ts=datetime.now(tz=timezone.utc).isoformat(),
        version="1.0.0",
        app_build=web_app._APP_BUILD,
        app_path=str(Path(web_app.__file__).resolve()),
    )


@router.get("/ready", response_model=ReadyResponse)
async def ready() -> ReadyResponse:
    from web.core.snapshot_cache import SNAPSHOT_PATH, load_snapshot

    if SNAPSHOT_PATH.exists():
        snap_age: float | None = None
        snap = load_snapshot()
        if snap:
            snap_age = (
                datetime.now(tz=timezone.utc)
                - snap.collected_at.replace(
                    tzinfo=timezone.utc if snap.collected_at.tzinfo is None else snap.collected_at.tzinfo,
                )
            ).total_seconds()
        return ReadyResponse(snapshot_age_seconds=snap_age)
    raise HTTPException(503, "No snapshot collected yet — service not ready")
