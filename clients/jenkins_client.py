"""
Jenkins REST API client.

Docs: https://www.jenkins.io/doc/book/using/remote-access-api/
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

from models.models import BuildRecord, BuildStatus
from .base import BaseCIClient

logger = logging.getLogger(__name__)

_STATUS_MAP: dict[str, BuildStatus] = {
    "SUCCESS": BuildStatus.SUCCESS,
    "FAILURE": BuildStatus.FAILURE,
    "ABORTED": BuildStatus.ABORTED,
    "UNSTABLE": BuildStatus.UNSTABLE,
    "IN_PROGRESS": BuildStatus.RUNNING,
    None: BuildStatus.UNKNOWN,
}


class JenkinsClient(BaseCIClient):
    """Adapter for Jenkins Blue Ocean / classic REST API."""

    def __init__(
        self,
        url: str,
        username: str,
        token: str,
        jobs: list[dict[str, Any]] | None = None,
        timeout: int = 15,
        show_all: bool = False,
        show_all_limit_jobs: int | None = None,
        verify_ssl: bool = True,
        progress_cb: callable | None = None,
    ) -> None:
        super().__init__(url, token, timeout, verify_ssl=verify_ssl)
        self.session.auth = (username, token)
        self.jobs: list[dict[str, Any]] = jobs or []
        self.show_all = show_all
        self.show_all_limit_jobs = show_all_limit_jobs
        self.progress_cb = progress_cb

    # ── helpers ─────────────────────────────────────────────────────────────

    def _parse_build(self, raw: dict, job_name: str, critical: bool) -> BuildRecord:
        ts_ms = raw.get("timestamp")
        started = (
            datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc) if ts_ms else None
        )
        duration_ms = raw.get("duration", 0)
        result = raw.get("result")
        return BuildRecord(
            source="jenkins",
            job_name=job_name,
            build_number=raw.get("number"),
            status=_STATUS_MAP.get(result, BuildStatus.UNKNOWN),
            started_at=started,
            duration_seconds=duration_ms / 1000 if duration_ms else None,
            url=raw.get("url"),
            critical=critical,
        )

    def fetch_last_builds_bulk(
        self,
        *,
        since: datetime | None = None,
        limit_jobs: int | None = None,
        depth: int = 4,
    ) -> list[BuildRecord]:
        """
        Fetch lastBuild/lastCompletedBuild for many jobs in a single Jenkins API request.

        This is dramatically faster than per-job requests when show_all_jobs is enabled.
        """
        def _tree(level: int) -> str:
            base = (
                "name,color,url,_class,"
                "lastBuild[number,result,timestamp,duration,url],"
                "lastCompletedBuild[number,result,timestamp,duration,url]"
            )
            if level <= 0:
                return base
            return base + f",jobs[{_tree(level - 1)}]"

        # NOTE: Jenkins often has folders / multibranch containers at the top level.
        # We fetch a bounded recursive tree and then flatten only leaf jobs (no children).
        q = f"/api/json?tree=jobs[{_tree(max(0, int(depth or 0)))}]"
        data = self._get(q)
        if not isinstance(data, dict):
            return []
        root_jobs = data.get("jobs") or []
        if not isinstance(root_jobs, list):
            return []

        def _iter_leaf_jobs(nodes: list, prefix: str = "") -> list[dict[str, Any]]:
            out: list[dict[str, Any]] = []
            for n in nodes or []:
                if not isinstance(n, dict):
                    continue
                name = (n.get("name") or "").strip()
                if not name:
                    continue
                full = f"{prefix}/{name}" if prefix else name
                ch = n.get("jobs") or []
                if isinstance(ch, list) and ch:
                    out.extend(_iter_leaf_jobs(ch, full))
                else:
                    m = dict(n)
                    m["_full_name"] = full
                    out.append(m)
            return out

        jobs = _iter_leaf_jobs(root_jobs)
        if isinstance(limit_jobs, int) and limit_jobs > 0:
            jobs = jobs[:limit_jobs]

        critical_by_name = {
            (j.get("name") or ""): bool(j.get("critical", False)) for j in (self.jobs or [])
        }

        out: list[BuildRecord] = []
        for j in jobs:
            if not isinstance(j, dict):
                continue
            name = (j.get("_full_name") or j.get("name") or "").strip()
            if not name:
                continue
            # Prefer lastCompletedBuild to avoid RUNNING/UNKNOWN when the latest build is in progress.
            raw_build = j.get("lastCompletedBuild") or j.get("lastBuild") or {}
            if not isinstance(raw_build, dict) or not raw_build:
                # No builds yet (or job disabled) — still expose job as UNKNOWN.
                out.append(
                    BuildRecord(
                        source="jenkins",
                        job_name=name,
                        build_number=None,
                        status=BuildStatus.UNKNOWN,
                        started_at=None,
                        duration_seconds=None,
                        url=j.get("url"),
                        critical=bool(critical_by_name.get(name, False)),
                    )
                )
                continue

            rec = self._parse_build(
                raw_build,
                name,
                bool(critical_by_name.get(name, False)),
            )
            # The build timestamp check is only meaningful if lastBuild has timestamp.
            if since and rec.started_at and rec.started_at < since:
                # Keep it anyway (dashboard wants "latest known status").
                pass
            # Prefer job URL if build URL isn't present for some reason.
            if not rec.url:
                rec.url = j.get("url")
            out.append(rec)

        logger.info("Jenkins: bulk fetched %d last-build records", len(out))
        return out

    # ── public interface ─────────────────────────────────────────────────────

    def fetch_builds(
        self,
        since: datetime | None = None,
        max_builds: int = 10,
    ) -> list[BuildRecord]:
        if self.show_all:
            discovered = self.fetch_job_list()
            if isinstance(self.show_all_limit_jobs, int) and self.show_all_limit_jobs > 0:
                discovered = discovered[: self.show_all_limit_jobs]
            explicit_names = {j.get("name") for j in self.jobs}
            extra = [{"name": n, "critical": False, "parse_console": False}
                     for n in discovered if n not in explicit_names]
            job_list = list(self.jobs) + extra
        else:
            job_list = self.jobs

        records: list[BuildRecord] = []
        total = len(job_list) if job_list else 0
        for idx, job_cfg in enumerate(job_list, start=1):
            job_name = job_cfg.get("name", "")
            critical = job_cfg.get("critical", False)
            if self.progress_cb:
                try:
                    self.progress_cb(f"Builds: {idx}/{total} {job_name}")
                except Exception:
                    pass
            jp = self.job_path(job_name)
            # max_builds <= 0 means "no explicit limit" (Jenkins decides how many to return).
            if int(max_builds) <= 0:
                path = f"{jp}/api/json?tree=builds[number,result,timestamp,duration,url]"
            else:
                path = f"{jp}/api/json?tree=builds[number,result,timestamp,duration,url]{{0,{int(max_builds)}}}"
            data = self._get(path)
            if not data:
                logger.warning("No data returned for Jenkins job '%s'", job_name)
                continue
            builds_raw = data.get("builds", [])
            for i, raw_build in enumerate(builds_raw):
                record = self._parse_build(raw_build, job_name, critical)
                # Always include the most recent build (i==0) even if older than since
                if i > 0 and since and record.started_at and record.started_at < since:
                    break
                records.append(record)
        logger.info("Jenkins: fetched %d build records", len(records))
        return records

    @staticmethod
    def job_path(job_name: str) -> str:
        """Build `/job/.../job/...` path segment for Jenkins REST API."""
        parts = [p for p in job_name.replace("\\", "/").split("/") if p]
        return "/job/" + "/job/".join(quote(p, safe="") for p in parts)

    def fetch_console_text(self, job_name: str, build_number: int) -> str:
        """Download plain-text console output for a finished build."""
        jp = self.job_path(job_name)
        path = f"{jp}/{int(build_number)}/consoleText"
        return self._get_text(path)

    def trigger_build(self, job_name: str) -> dict:
        """Trigger a new build for the given job. Returns status info."""
        jp = self.job_path(job_name)
        resp = self._post(f"{jp}/build")
        return {"ok": True, "status": resp.status_code, "job": job_name}

    def fetch_job_list(self) -> list[str]:
        """
        Return names of jobs visible to this user.

        Jenkins commonly has folders / multibranch containers, so we fetch a bounded
        recursive tree and return only leaf jobs as "folder/sub/job" names.
        """
        def _tree(level: int) -> str:
            base = "name,_class,jobs[name,_class]"
            if level <= 0:
                return "name,_class"
            # Keep payload small: name + nested jobs list only.
            return "name,_class," + f"jobs[{_tree(level - 1)}]"

        depth = 4
        data = self._get(f"/api/json?tree=jobs[{_tree(depth)}]")
        if not isinstance(data, dict):
            return []
        root_jobs = data.get("jobs") or []
        if not isinstance(root_jobs, list):
            return []

        def _iter_leaf_names(nodes: list, prefix: str = "") -> list[str]:
            out: list[str] = []
            for n in nodes or []:
                if not isinstance(n, dict):
                    continue
                name = (n.get("name") or "").strip()
                if not name:
                    continue
                full = f"{prefix}/{name}" if prefix else name
                ch = n.get("jobs") or []
                if isinstance(ch, list) and ch:
                    out.extend(_iter_leaf_names(ch, full))
                else:
                    out.append(full)
            return out

        return _iter_leaf_names(root_jobs)
