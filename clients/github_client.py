"""
GitHub Actions REST API client.

Docs: https://docs.github.com/en/rest/actions/workflow-runs
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any
from urllib.parse import quote

import requests

from models.models import BuildRecord, BuildStatus

logger = logging.getLogger(__name__)

_STATUS_MAP: dict[str, BuildStatus] = {
    "success": BuildStatus.SUCCESS,
    "failure": BuildStatus.FAILURE,
    "cancelled": BuildStatus.ABORTED,
    "skipped": BuildStatus.ABORTED,
    "timed_out": BuildStatus.FAILURE,
    "action_required": BuildStatus.UNSTABLE,
    "neutral": BuildStatus.UNKNOWN,
    "stale": BuildStatus.UNKNOWN,
}


def normalize_github_api_base(url: str) -> str:
    """Map github.com UI URL or host to REST API root."""
    u = str(url or "").strip().rstrip("/")
    if not u:
        return "https://api.github.com"
    low = u.lower()
    if low.endswith("/api/v3"):
        return u
    if "api.github.com" in low:
        return u.split("/api")[0] + "/api" if "/api" not in u else u
    if low.endswith("github.com"):
        return "https://api.github.com"
    if "/api/" in u:
        return u
    return f"{u}/api/v3"


class GitHubClient:
    """Adapter for GitHub Actions workflow runs."""

    def __init__(
        self,
        url: str,
        token: str,
        repos: list[dict[str, Any]] | None = None,
        timeout: int = 15,
        show_all: bool = False,
        verify_ssl: bool = True,
        source_instance: str | None = None,
    ) -> None:
        self.api_base = normalize_github_api_base(url)
        self.web_base = self._web_base_from_api(self.api_base)
        self.token = str(token or "").strip()
        self.timeout = timeout
        self.verify_ssl = verify_ssl
        self.repos: list[dict[str, Any]] = repos or []
        self.show_all = show_all
        self.source_instance = (source_instance or "").strip() or None
        self.session = requests.Session()
        if self.token:
            self.session.headers.update(
                {
                    "Authorization": f"Bearer {self.token}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                }
            )

    @staticmethod
    def _web_base_from_api(api_base: str) -> str:
        if api_base.rstrip("/").endswith("/api/v3"):
            return api_base.rsplit("/api", 1)[0] or "https://github.com"
        if "api.github.com" in api_base:
            return "https://github.com"
        return api_base.replace("/api/v3", "").rstrip("/") or api_base

    @staticmethod
    def _parse_dt(value: str | None) -> datetime | None:
        if not value:
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None

    def _get(self, path: str, **kwargs: Any) -> dict | list:
        url = f"{self.api_base}{path}"
        try:
            kwargs.setdefault("verify", self.verify_ssl)
            kwargs.setdefault("timeout", self.timeout)
            resp = self.session.get(url, **kwargs)
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as exc:
            logger.error("GitHub GET %s failed: %s", url, exc)
            raise

    def fetch_user_login(self) -> str:
        data = self._get("/user")
        if isinstance(data, dict):
            return str(data.get("login") or "").strip()
        return ""

    def fetch_repo_list(self) -> list[str]:
        """Repos visible to the token (owner + collaborator)."""
        out: list[str] = []
        page = 1
        while page <= 5:
            data = self._get("/user/repos", params={"per_page": 100, "page": page, "sort": "updated"})
            if not isinstance(data, list) or not data:
                break
            for row in data:
                if not isinstance(row, dict):
                    continue
                full = str(row.get("full_name") or "").strip()
                if full:
                    out.append(full)
            if len(data) < 100:
                break
            page += 1
        return out

    def _map_run_status(self, raw: dict) -> BuildStatus:
        status = str(raw.get("status") or "").lower()
        conclusion = str(raw.get("conclusion") or "").lower()
        if status in ("queued", "in_progress", "waiting", "pending", "requested"):
            return BuildStatus.RUNNING
        if conclusion:
            return _STATUS_MAP.get(conclusion, BuildStatus.UNKNOWN)
        return BuildStatus.UNKNOWN

    def _parse_run(self, raw: dict, repo: str, critical: bool) -> BuildRecord | None:
        run_id = raw.get("id")
        if run_id is None:
            return None
        started = self._parse_dt(raw.get("run_started_at") or raw.get("created_at"))
        updated = self._parse_dt(raw.get("updated_at"))
        duration: float | None = None
        if started and updated and updated > started:
            duration = (updated - started).total_seconds()
        workflow = str((raw.get("name") or raw.get("display_title") or "")).strip()
        job_name = f"{repo}" + (f" · {workflow}" if workflow else "")
        url = raw.get("html_url") or raw.get("url") or ""
        if isinstance(url, str) and url.startswith("/"):
            url = f"{self.web_base}{url}"
        return BuildRecord(
            source="github",
            source_instance=self.source_instance,
            job_name=job_name[:240],
            build_number=run_id,
            status=self._map_run_status(raw),
            started_at=started,
            duration_seconds=duration,
            branch=raw.get("head_branch"),
            commit_sha=raw.get("head_sha"),
            url=str(url) if url else None,
            critical=critical,
        )

    def fetch_runs_for_repo(
        self,
        repo: str,
        *,
        since: datetime | None = None,
        max_runs: int = 10,
        critical: bool = False,
        should_cancel=None,
    ) -> list[BuildRecord]:
        repo = str(repo or "").strip()
        if not repo or "/" not in repo:
            return []
        enc = quote(repo, safe="")
        per_page = min(max(1, int(max_runs or 10)), 100)
        data = self._get(f"/repos/{enc}/actions/runs", params={"per_page": per_page})
        if not isinstance(data, dict):
            return []
        rows = data.get("workflow_runs")
        if not isinstance(rows, list):
            return []
        out: list[BuildRecord] = []
        for raw in rows:
            if should_cancel:
                should_cancel()
            if not isinstance(raw, dict):
                continue
            rec = self._parse_run(raw, repo, critical)
            if not rec:
                continue
            if since and rec.started_at and rec.started_at < since:
                continue
            out.append(rec)
            if len(out) >= per_page:
                break
        return out
