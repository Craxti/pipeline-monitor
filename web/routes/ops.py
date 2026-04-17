"""Liveness / readiness probes."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from web.schemas import HealthResponse, ReadyResponse
from web.core.paths import REPO_ROOT
from web.services.app_constants import APP_BUILD

router = APIRouter(tags=["ops"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Simple liveness probe."""
    return HealthResponse(
        ts=datetime.now(tz=timezone.utc).isoformat(),
        version="1.0.0",
        app_build=APP_BUILD,
        app_path=str((REPO_ROOT / "web" / "app.py").resolve()),
    )


@router.get("/ready", response_model=ReadyResponse)
async def ready() -> ReadyResponse:
    """Readiness probe: requires at least one snapshot present."""
    from web.core.snapshot_cache import SNAPSHOT_PATH, load_snapshot

    if SNAPSHOT_PATH.exists():
        snap_age: float | None = None
        snap = load_snapshot()
        if snap:
            snap_age = (
                datetime.now(tz=timezone.utc)
                - snap.collected_at.replace(
                    tzinfo=timezone.utc
                    if snap.collected_at.tzinfo is None
                    else snap.collected_at.tzinfo,
                )
            ).total_seconds()
        return ReadyResponse(snapshot_age_seconds=snap_age)
    raise HTTPException(503, "No snapshot collected yet — service not ready")
