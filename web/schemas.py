"""Pydantic models for HTTP API boundaries (health, readiness, incident bundle, config)."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    """Response model for `/health` endpoint."""

    status: Literal["ok"] = "ok"
    ts: str = Field(..., description="UTC ISO-8601 timestamp")
    version: str
    app_build: str
    app_path: str


class ReadyResponse(BaseModel):
    """Response model for `/ready` endpoint."""

    status: Literal["ready"] = "ready"
    snapshot_age_seconds: Optional[float] = Field(
        default=None,
        description="Seconds since last snapshot UTC; null if snapshot missing fields",
    )


# ── config.yaml boundary (minimal ``general`` section) ─────────────────────


class MonitorGeneralConfig(BaseModel):
    """Typed slice of ``config.yaml`` → ``general`` (validated when loading for UI)."""

    model_config = ConfigDict(extra="ignore")

    project_name: str = "CI/CD Monitor"
    default_lookback_days: int = 7
    data_dir: str = "data"
    log_level: str = "INFO"
    ui_language: str = "en"


# ── Incident bundle (JSON body for /api/incident*, export) ─────────────────


class IncidentFailedBuildRow(BaseModel):
    """Row for a failed build in incident bundle export."""

    model_config = ConfigDict(extra="ignore")

    source: str
    job_name: str
    build_number: Optional[int] = None
    status: str
    branch: Optional[str] = None
    started_at: Optional[str] = None
    url: Optional[str] = None
    critical: Optional[bool] = None


class IncidentTopFailedTestRow(BaseModel):
    """Row for a top failing test in incident bundle export."""

    test_name: str
    count: int


class IncidentServiceDownRow(BaseModel):
    """Row for a down/degraded service in incident bundle export."""

    model_config = ConfigDict(extra="ignore")

    name: str
    kind: str
    status: str
    detail: Optional[str] = None


class IncidentSummaryBlock(BaseModel):
    """Summary counts block for incident bundle."""

    failed_builds: int
    failed_tests_in_snapshot: int
    services_down: int


class IncidentBundlePayload(BaseModel):
    """Stable JSON shape for incident export endpoints."""

    model_config = ConfigDict(extra="ignore")

    generated_at_utc: str
    snapshot_collected_at_utc: Optional[str] = None
    summary: IncidentSummaryBlock
    failed_builds: list[IncidentFailedBuildRow]
    top_failed_tests: list[IncidentTopFailedTestRow]
    services_down: list[IncidentServiceDownRow]
    note: Optional[str] = None
