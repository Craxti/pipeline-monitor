"""
Jenkins REST API client.

Docs: https://www.jenkins.io/doc/book/using/remote-access-api/
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote, urlparse

import requests
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
        source_instance: str | None = None,
    ) -> None:
        super().__init__(url, token, timeout, verify_ssl=verify_ssl)
        self.session.auth = (username, token)
        self.jobs: list[dict[str, Any]] = jobs or []
        self.show_all = show_all
        self.show_all_limit_jobs = show_all_limit_jobs
        self.progress_cb = progress_cb
        self.source_instance = (source_instance or "").strip() or None

    # ── helpers ─────────────────────────────────────────────────────────────

    def _parse_build(self, raw: dict, job_name: str, critical: bool) -> BuildRecord:
        ts_ms = raw.get("timestamp")
        started = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc) if ts_ms else None
        duration_ms = raw.get("duration")
        result = raw.get("result")
        duration_seconds = None
        if duration_ms is not None:
            try:
                duration_seconds = float(duration_ms) / 1000.0
            except (TypeError, ValueError):
                duration_seconds = None
        return BuildRecord(
            source="jenkins",
            source_instance=self.source_instance,
            job_name=job_name,
            build_number=raw.get("number"),
            status=_STATUS_MAP.get(result, BuildStatus.UNKNOWN),
            started_at=started,
            duration_seconds=duration_seconds,
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

        critical_by_name = {(j.get("name") or ""): bool(j.get("critical", False)) for j in (self.jobs or [])}

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
                        source_instance=self.source_instance,
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
        should_cancel: callable | None = None,
    ) -> list[BuildRecord]:
        if self.show_all:
            discovered = self.fetch_job_list()
            if isinstance(self.show_all_limit_jobs, int) and self.show_all_limit_jobs > 0:
                discovered = discovered[: self.show_all_limit_jobs]
            explicit_names = {j.get("name") for j in self.jobs}
            extra = [
                {"name": n, "critical": False, "parse_console": False} for n in discovered if n not in explicit_names
            ]
            job_list = list(self.jobs) + extra
        else:
            job_list = self.jobs

        records: list[BuildRecord] = []
        total = len(job_list) if job_list else 0
        for idx, job_cfg in enumerate(job_list, start=1):
            if should_cancel:
                should_cancel()
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
                if should_cancel:
                    should_cancel()
                record = self._parse_build(raw_build, job_name, critical)
                # Always include the most recent build (i==0) even if older than since
                if i > 0 and since and record.started_at and record.started_at < since:
                    break
                records.append(record)
        logger.info("Jenkins: fetched %d build records", len(records))
        return records

    def fetch_builds_for_job(
        self,
        job_name: str,
        *,
        since: datetime | None = None,
        max_builds: int = 10,
        critical: bool = False,
        should_cancel: callable | None = None,
    ) -> list[BuildRecord]:
        """Fetch up to ``max_builds`` recent builds for a single job (by full folder path)."""
        if not job_name or not str(job_name).strip():
            return []
        jp = self.job_path(job_name)
        if int(max_builds) <= 0:
            path = f"{jp}/api/json?tree=builds[number,result,timestamp,duration,url]"
        else:
            path = f"{jp}/api/json?tree=builds[number,result,timestamp,duration,url]" f"{{0,{int(max_builds)}}}"
        data = self._get(path)
        if not data:
            return []
        builds_raw = data.get("builds") or []
        records: list[BuildRecord] = []
        for i, raw_build in enumerate(builds_raw):
            if should_cancel:
                should_cancel()
            if not isinstance(raw_build, dict):
                continue
            record = self._parse_build(raw_build, job_name, critical)
            if i > 0 and since and record.started_at and record.started_at < since:
                break
            records.append(record)
        return records

    @staticmethod
    def job_path(job_name: str) -> str:
        """Build `/job/.../job/...` path segment for Jenkins REST API."""
        parts = [p for p in job_name.replace("\\", "/").split("/") if p]
        return "/job/" + "/job/".join(quote(p, safe="") for p in parts)

    @staticmethod
    def job_names_equivalent(a: str, b: str) -> bool:
        """
        True if two Jenkins job identifiers refer to the same job.

        Bulk API / folder trees often yield ``Folder/Sub/Regress`` while console
        config may list only ``Regress`` (or the reverse).
        """
        xa = (a or "").strip().replace("\\", "/")
        xb = (b or "").strip().replace("\\", "/")
        if not xa or not xb:
            return False
        if xa == xb:
            return True
        if xa.endswith("/" + xb) or xb.endswith("/" + xa):
            return True
        return False

    def fetch_console_text(self, job_name: str, build_number: int) -> str:
        """Download plain-text console output for a finished build."""
        jp = self.job_path(job_name)
        path = f"{jp}/{int(build_number)}/consoleText"
        return self._get_text(path)

    def _get_json_maybe(self, path: str) -> dict[str, Any] | None:
        """GET JSON object; return ``None`` on 404 or failure (unlike ``_get`` which returns ``{}``)."""
        url = f"{self.base_url}{path}"
        try:
            resp = self.session.get(url, timeout=self.timeout, verify=self.verify_ssl)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, dict) else None
        except Exception as exc:
            logger.warning("Jenkins GET %s failed: %s", path, exc)
            return None

    def fetch_allure_case_dict(self, job_name: str, build_number: int, uid: str) -> dict[str, Any] | None:
        """Jenkins Allure plugin: ``.../allure/data/test-cases/<uid>.json``."""
        jp = self.job_path(job_name)
        u = (uid or "").strip()
        if not u:
            return None
        path = f"{jp}/{int(build_number)}/allure/data/test-cases/{u}.json"
        return self._get_json_maybe(path)

    def fetch_allure_data_bytes(self, job_name: str, build_number: int, relative_under_data: str) -> tuple[bytes, str | None] | None:
        """GET raw bytes under ``.../allure/data/<relative_under_data>`` (e.g. ``attachments/....png``)."""
        jp = self.job_path(job_name)
        rel = (relative_under_data or "").strip().lstrip("/")
        if not rel or ".." in rel:
            return None
        path = f"{jp}/{int(build_number)}/allure/data/{rel}"
        url = f"{self.base_url}{path}"
        try:
            resp = self.session.get(url, timeout=self.timeout, verify=self.verify_ssl)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            ct = resp.headers.get("content-type")
            return (resp.content, ct)
        except Exception as exc:
            logger.warning("Jenkins GET bytes %s failed: %s", path, exc)
            return None

    def fetch_reference_build_number(self, job_name: str, *, prefer_success: bool = True) -> int | None:
        """
        Return a "good reference" build number for log diffing.

        Jenkins snapshots may only contain the most recent build per job; in that case we try to
        resolve lastSuccessfulBuild directly from Jenkins job metadata.
        """
        jp = self.job_path(job_name)
        tree = "lastSuccessfulBuild[number],lastCompletedBuild[number],lastBuild[number]"
        data = self._get(f"{jp}/api/json?tree={tree}")
        if not isinstance(data, dict):
            return None

        def _num(k: str) -> int | None:
            v = data.get(k)
            if not isinstance(v, dict):
                return None
            n = v.get("number")
            try:
                return int(n) if n is not None else None
            except Exception:
                return None

        if prefer_success:
            n = _num("lastSuccessfulBuild")
            if n is not None:
                return n
        n = _num("lastCompletedBuild")
        if n is not None:
            return n
        return _num("lastBuild")

    def _api_path_from_location(self, location: str) -> str | None:
        """Turn Location header (absolute or relative) into a path for ``_get``."""
        loc = (location or "").strip()
        if not loc:
            return None
        base = self.base_url.rstrip("/")
        if loc.startswith(base):
            rest = loc[len(base) :]
            return rest if rest.startswith("/") else "/" + rest
        parsed = urlparse(loc)
        path = (parsed.path or "").strip()
        if path.startswith("/"):
            return path
        return "/" + path if path else None

    def _poll_queue_for_executable(self, location: str, *, max_wait_s: float = 18.0) -> dict[str, Any]:
        """Follow queue item until Jenkins assigns an executable build (or timeout)."""
        base_path = self._api_path_from_location(location)
        if not base_path:
            return {}
        qpath = base_path.rstrip("/") + "/api/json?tree=executable[number,url],cancelled,why"
        deadline = time.monotonic() + max_wait_s
        while time.monotonic() < deadline:
            data = self._get(qpath)
            if not isinstance(data, dict):
                break
            if data.get("cancelled"):
                logger.info("Jenkins queue item cancelled: %s", qpath)
                break
            ex = data.get("executable")
            if isinstance(ex, dict) and ex.get("number") is not None:
                try:
                    num = int(ex["number"])
                except (TypeError, ValueError):
                    num = None
                if num is not None:
                    return {"build_number": num, "url": str(ex.get("url") or "").strip() or None}
            time.sleep(0.35)
        return {}

    def trigger_build(self, job_name: str) -> dict:
        """Trigger a new build for the given job. Returns status info."""
        jp = self.job_path(job_name)
        logger.info("Jenkins trigger_build requested: job=%s", job_name)
        headers: dict[str, str] = {}
        try:
            crumb = self._get("/crumbIssuer/api/json")
            if isinstance(crumb, dict):
                field = str(crumb.get("crumbRequestField") or "").strip()
                value = str(crumb.get("crumb") or "").strip()
                if field and value:
                    headers[field] = value
                    logger.info("Jenkins crumb received for job=%s field=%s", job_name, field)
        except Exception:
            headers = {}
            logger.warning("Jenkins crumb request failed for job=%s; trying without crumb", job_name)
        # Some Jenkins jobs are parameterized and only accept /buildWithParameters.
        # Try /build first, then fallback.
        last_exc: Exception | None = None
        for endpoint in (f"{jp}/build", f"{jp}/buildWithParameters"):
            try:
                logger.info("Jenkins trigger attempt: endpoint=%s job=%s", endpoint, job_name)
                resp = self._post(endpoint, headers=headers or None)
                result: dict[str, Any] = {"ok": True, "status": resp.status_code, "job": job_name}
                loc = (resp.headers.get("Location") or resp.headers.get("location") or "").strip()
                if loc:
                    extra = self._poll_queue_for_executable(loc)
                    if extra:
                        result.update(extra)
                        logger.info("Jenkins queue resolved: job=%s %s", job_name, extra)
                logger.info("Jenkins trigger success: %s", result)
                return result
            except requests.HTTPError as exc:
                last_exc = exc
                status = exc.response.status_code if exc.response is not None else None
                logger.warning(
                    "Jenkins trigger HTTP error: endpoint=%s job=%s status=%s",
                    endpoint,
                    job_name,
                    status,
                )
                # Try fallback only for request-shape related statuses.
                if endpoint.endswith("/build") and status in (400, 404, 405):
                    continue
                raise
        if last_exc is not None:
            raise last_exc
        raise RuntimeError("Failed to trigger Jenkins build")

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
