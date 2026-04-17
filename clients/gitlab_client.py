"""
GitLab REST API v4 client.

Docs: https://docs.gitlab.com/ee/api/pipelines.html
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any
from urllib.parse import quote_plus

from models.models import BuildRecord, BuildStatus
from .base import BaseCIClient

logger = logging.getLogger(__name__)

_STATUS_MAP: dict[str, BuildStatus] = {
    "success": BuildStatus.SUCCESS,
    "failed": BuildStatus.FAILURE,
    "running": BuildStatus.RUNNING,
    "canceled": BuildStatus.ABORTED,
    "pending": BuildStatus.RUNNING,
    "skipped": BuildStatus.ABORTED,
    "manual": BuildStatus.UNKNOWN,
}


class GitLabClient(BaseCIClient):
    """Adapter for GitLab Pipelines REST API."""

    def __init__(
        self,
        url: str,
        token: str,
        projects: list[dict[str, Any]] | None = None,
        timeout: int = 15,
        show_all: bool = False,
        verify_ssl: bool = True,
        source_instance: str | None = None,
    ) -> None:
        super().__init__(url, token, timeout, verify_ssl=verify_ssl)
        self.session.headers.update({"PRIVATE-TOKEN": token})
        self.projects: list[dict[str, Any]] = projects or []
        self.show_all = show_all
        self.source_instance = (source_instance or "").strip() or None

    # ── helpers ─────────────────────────────────────────────────────────────

    @staticmethod
    def _parse_dt(value: str | None) -> datetime | None:
        if not value:
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None

    def _parse_pipeline(self, raw: dict, project_id: str, critical: bool) -> BuildRecord:
        started = self._parse_dt(raw.get("created_at"))
        updated = self._parse_dt(raw.get("updated_at"))
        duration: float | None = None
        if started and updated and updated > started:
            duration = (updated - started).total_seconds()
        return BuildRecord(
            source="gitlab",
            source_instance=self.source_instance,
            job_name=project_id,
            build_number=raw.get("id"),
            status=_STATUS_MAP.get(raw.get("status", ""), BuildStatus.UNKNOWN),
            started_at=started,
            duration_seconds=duration,
            branch=raw.get("ref"),
            commit_sha=raw.get("sha"),
            url=raw.get("web_url"),
            critical=critical,
        )

    # ── public interface ─────────────────────────────────────────────────────

    def _resolve_project(self, proj_id: str) -> str | None:
        """
        Try to resolve a namespace/path project identifier to a numeric ID.
        Returns the numeric ID as string, or None on failure.
        Falls back to the URL-encoded path if the project info API returns it.
        """
        encoded = quote_plus(proj_id)
        data = self._get(f"/api/v4/projects/{encoded}")
        if isinstance(data, dict) and "id" in data:
            logger.debug(
                "GitLab: resolved '%s' -> project ID %s (%s)",
                proj_id,
                data["id"],
                data.get("path_with_namespace", ""),
            )
            return str(data["id"])
        # Last-resort: search by project name
        name = proj_id.split("/")[-1]
        results = self._get(f"/api/v4/projects?search={quote_plus(name)}&per_page=10")
        if isinstance(results, list):
            for item in results:
                if item.get("path_with_namespace", "").lower() == proj_id.lower():
                    logger.debug("GitLab: found '%s' via search -> ID %s", proj_id, item["id"])
                    return str(item["id"])
        logger.warning("GitLab: could not resolve project '%s' — skipping.", proj_id)
        return None

    def trigger_pipeline(self, project_id: str, ref: str = "main") -> dict:
        """Trigger a new pipeline for the given project on the given branch."""
        resolved = self._resolve_project(project_id)
        if resolved is None:
            resolved = quote_plus(project_id)
        resp = self._post(f"/api/v4/projects/{resolved}/pipeline", json={"ref": ref})
        data = resp.json()
        return {"ok": True, "pipeline_id": data.get("id"), "web_url": data.get("web_url")}

    def fetch_project_list(self) -> list[str]:
        """Return path_with_namespace for all projects the token has access to."""
        results, page = [], 1
        while True:
            data = self._get(f"/api/v4/projects?membership=true&per_page=100&page={page}")
            if not isinstance(data, list) or not data:
                break
            results.extend(item.get("path_with_namespace", "") for item in data if item.get("path_with_namespace"))
            if len(data) < 100:
                break
            page += 1
        return results

    def fetch_builds(
        self,
        since: datetime | None = None,
        max_builds: int = 10,
    ) -> list[BuildRecord]:
        if self.show_all:
            discovered = self.fetch_project_list()
            explicit_ids = {str(p.get("id", "")).lower() for p in self.projects}
            extra = [{"id": path, "critical": False} for path in discovered if path.lower() not in explicit_ids]
            project_list = list(self.projects) + extra
        else:
            project_list = self.projects

        records: list[BuildRecord] = []
        for proj_cfg in project_list:
            proj_id = str(proj_cfg.get("id", ""))
            critical = proj_cfg.get("critical", False)

            # Resolve to numeric ID for reliable lookup
            resolved_id = self._resolve_project(proj_id)
            if resolved_id is None:
                # Try the URL-encoded path directly as fallback
                resolved_id = quote_plus(proj_id)

            path = f"/api/v4/projects/{resolved_id}/pipelines" f"?per_page={max_builds}&order_by=id&sort=desc"
            data = self._get(path)
            if not isinstance(data, list):
                logger.warning(
                    "GitLab: no pipeline list for project '%s' (id=%s)",
                    proj_id,
                    resolved_id,
                )
                continue
            if not data:
                logger.info("GitLab: project '%s' has no pipelines.", proj_id)
                continue

            project_records: list[BuildRecord] = []
            for i, raw_pipe in enumerate(data):
                record = self._parse_pipeline(raw_pipe, proj_id, critical)
                # Always keep the most-recent pipeline (i==0) even if older than since
                if i > 0 and since and record.started_at and record.started_at < since:
                    break  # list is newest-first; everything after is older
                project_records.append(record)

            records.extend(project_records)
            logger.debug("GitLab: project '%s' -> %d pipelines", proj_id, len(project_records))

        logger.info("GitLab: fetched %d pipeline records total", len(records))
        return records

    def fetch_pipeline_logs(self, project_id: str, pipeline_id: int) -> str:
        """
        Concatenate plain-text job traces for a pipeline (same order as job id).
        """
        resolved = self._resolve_project(project_id)
        if resolved is None:
            resolved = quote_plus(project_id)
        jobs = self._get(f"/api/v4/projects/{resolved}/pipelines/{int(pipeline_id)}/jobs" f"?per_page=100")
        if not isinstance(jobs, list) or not jobs:
            return "(no jobs in this pipeline)\n"
        chunks: list[str] = []
        for j in sorted(jobs, key=lambda x: x.get("id", 0)):
            jid = j.get("id")
            if jid is None:
                continue
            name = j.get("name", str(jid))
            stage = j.get("stage", "")
            path = f"/api/v4/projects/{resolved}/jobs/{jid}/trace"
            try:
                trace = self._get_text(path)
            except Exception as exc:
                logger.warning("GitLab trace job %s: %s", jid, exc)
                trace = f"[trace unavailable: {exc}]\n"
            chunks.append(f"{'=' * 60}\n# {stage} / {name} (job id={jid})\n{'=' * 60}\n{trace}\n")
        return "".join(chunks)
