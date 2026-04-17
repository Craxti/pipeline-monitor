"""
Pydantic data models shared across all modules.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, computed_field


def normalize_build_status(raw: object) -> str:
    """Canonical build status for filtering (lowercase enum value)."""
    if isinstance(raw, str):
        s = raw.strip().lower()
    else:
        s = str(getattr(raw, "value", raw)).strip().lower()
    aliases = {
        "pass": "success",
        "passed": "success",
        "ok": "success",
        "fail": "failure",
        "failed": "failure",
        "error": "failure",
    }
    s = aliases.get(s, s)
    known = ("success", "failure", "running", "aborted", "unstable", "unknown")
    return s if s in known else "unknown"


def normalize_test_status(raw: str) -> str:
    """Map parser-specific strings to a small set for filtering and counts."""
    s = (raw or "").strip().lower()
    aliases = {
        "pass": "passed",
        "passed": "passed",
        "ok": "passed",
        "success": "passed",
        "fail": "failed",
        "failed": "failed",
        "failure": "failed",
        "error": "error",
        "err": "error",
        "skip": "skipped",
        "skipped": "skipped",
        "pending": "pending",
        "pend": "pending",
        "xfail": "xfailed",
        "xpass": "xpassed",
    }
    out = aliases.get(s, s)
    if out in ("passed", "failed", "error", "skipped", "pending", "xfailed", "xpassed"):
        return out
    return "unknown"


def normalize_service_status(raw: str) -> str:
    """Normalize service health strings into up/down/degraded/unknown."""
    s = (raw or "").strip().lower()
    if s in ("up", "healthy", "ok", "running"):
        return "up"
    if s in ("down", "unhealthy", "offline", "stopped"):
        return "down"
    if s in ("degraded", "warn", "warning"):
        return "degraded"
    return s or "unknown"


class BuildStatus(str, Enum):
    """Canonical build statuses used across collectors and UI."""
    SUCCESS = "success"
    FAILURE = "failure"
    RUNNING = "running"
    ABORTED = "aborted"
    UNSTABLE = "unstable"
    UNKNOWN = "unknown"


class BuildRecord(BaseModel):
    """Represents a single CI/CD build / pipeline run."""

    source: str = Field(..., description="CI system: jenkins | gitlab | ...")
    # Config instance name (or URL host fallback) — disambiguates merges when several
    # Jenkins/GitLab entries share one server URL or build URLs are missing.
    source_instance: Optional[str] = Field(
        default=None,
        description="Logical CI instance label from config",
    )
    job_name: str
    build_number: Optional[int] = None
    status: BuildStatus
    started_at: Optional[datetime] = None
    duration_seconds: Optional[float] = None
    branch: Optional[str] = None
    commit_sha: Optional[str] = None
    url: Optional[str] = None
    critical: bool = False

    model_config = {"use_enum_values": True}

    @computed_field
    @property
    def status_normalized(self) -> str:
        """Build status normalized to a stable lowercase string."""
        return normalize_build_status(self.status)


class TestRecord(BaseModel):
    """Represents a single test-case result from a parsed report."""

    source: str = Field(..., description="Parser type: pytest | allure | ...")
    # Config instance name (or URL host fallback) — disambiguates merges when several
    # Jenkins/GitLab entries are enabled and produce tests for the same suite/name.
    source_instance: Optional[str] = Field(
        default=None,
        description="Logical CI instance label from config",
    )
    suite: Optional[str] = None
    test_name: str
    status: str  # passed | failed | skipped | error
    duration_seconds: Optional[float] = None
    failure_message: Optional[str] = None
    timestamp: Optional[datetime] = None
    file_path: Optional[str] = None

    @computed_field
    @property
    def status_normalized(self) -> str:
        """Test status normalized to a stable lowercase string."""
        return normalize_test_status(self.status)


class ServiceStatus(BaseModel):
    """Result of a Docker / HTTP health check."""

    name: str
    kind: str = Field(..., description="docker | http")
    status: str  # up | down | degraded
    detail: Optional[str] = None
    checked_at: datetime = Field(default_factory=datetime.utcnow)

    @computed_field
    @property
    def status_normalized(self) -> str:
        """Service status normalized to a stable lowercase string."""
        return normalize_service_status(self.status)


# Backward-compatible alias (older code/tests use ServiceRecord name)
ServiceRecord = ServiceStatus


class CISnapshot(BaseModel):
    """Full snapshot collected in one monitoring run."""

    collected_at: datetime = Field(default_factory=datetime.utcnow)
    builds: list[BuildRecord] = []
    tests: list[TestRecord] = []
    services: list[ServiceStatus] = []
    # Per-source parse coverage from last collect
    # (e.g. jenkins jobs discovered vs Allure/console parsed).
    collect_meta: dict[str, Any] = Field(default_factory=dict)
