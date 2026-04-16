"""
Jenkins Allure report parser.

Reads test-case results from the Jenkins Allure plugin endpoints, e.g.:
  /job/<job>/<build>/allure/data/suites.json
  /job/<job>/<build>/allure/data/test-cases/<uid>.json
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

import requests

from clients.jenkins_client import JenkinsClient
from models.models import TestRecord
from parsers.allure_failure_text import failure_text_from_allure_case_dict

logger = logging.getLogger(__name__)


class JenkinsAllureParser:
    def __init__(
        self,
        url: str,
        username: str,
        token: str,
        jobs: list[dict],
        max_builds: int = 1,
        workers: int = 6,
        timeout: int = 30,
        verify_ssl: bool = True,
        progress_cb: callable | None = None,
        retries: int = 3,
        backoff_seconds: float = 0.8,
        records_cb: callable | None = None,
        timing_cb: callable | None = None,
    ) -> None:
        self.base_url = url.rstrip("/")
        self.auth = (username, token)
        self.jobs = jobs
        self.max_builds = max_builds
        self.workers = max(1, int(workers or 1))
        self.timeout = timeout
        self.verify_ssl = verify_ssl
        self.progress_cb = progress_cb
        self.retries = max(0, int(retries or 0))
        self.backoff_seconds = max(0.0, float(backoff_seconds or 0.0))
        self.records_cb = records_cb
        self.timing_cb = timing_cb

    def _should_retry_status(self, status_code: int | None) -> bool:
        return status_code in (408, 425, 429, 500, 502, 503, 504)

    def _get_json(self, path: str) -> dict | list | None:
        url = f"{self.base_url}{path}"
        attempt = 0
        while True:
            try:
                import time
                t0 = time.monotonic()
                r = requests.get(
                    url,
                    auth=self.auth,
                    timeout=self.timeout,
                    verify=self.verify_ssl,
                )
                elapsed_ms = int((time.monotonic() - t0) * 1000)
                if r.status_code >= 400 and self._should_retry_status(r.status_code) and attempt < self.retries:
                    delay = self.backoff_seconds * (2 ** attempt)
                    logger.warning("AllureParser: GET %s -> %d (%dms), retry in %.1fs", path, r.status_code, elapsed_ms, delay)
                    try:
                        time.sleep(delay)
                    except Exception:
                        pass
                    attempt += 1
                    continue
                r.raise_for_status()
                return r.json()
            except requests.HTTPError as exc:
                code = getattr(getattr(exc, "response", None), "status_code", None)
                if code is not None and self._should_retry_status(code) and attempt < self.retries:
                    delay = self.backoff_seconds * (2 ** attempt)
                    logger.warning("AllureParser: HTTP %s (%s), retry in %.1fs", path, code, delay)
                    try:
                        import time
                        time.sleep(delay)
                    except Exception:
                        pass
                    attempt += 1
                    continue
                logger.warning("AllureParser: GET %s failed: %s", path, exc)
                return None
            except Exception as exc:
                if attempt < self.retries:
                    delay = self.backoff_seconds * (2 ** attempt)
                    logger.warning("AllureParser: GET %s failed, retry in %.1fs: %s", path, delay, exc)
                    try:
                        import time
                        time.sleep(delay)
                    except Exception:
                        pass
                    attempt += 1
                    continue
                logger.warning("AllureParser: GET %s failed: %s", path, exc)
                return None

    def _fetch_build_numbers(self, job_name: str) -> list[int]:
        jp = JenkinsClient.job_path(job_name)
        # max_builds <= 0 means "no explicit limit" (Jenkins decides how many to return).
        if int(self.max_builds) <= 0:
            data = self._get_json(f"{jp}/api/json?tree=builds[number]")
        else:
            data = self._get_json(f"{jp}/api/json?tree=builds[number]{{0,{int(self.max_builds)}}}")
        if not isinstance(data, dict):
            return []
        builds = data.get("builds") or []
        out: list[int] = []
        for b in builds:
            try:
                out.append(int(b.get("number")))
            except Exception:
                pass
        return out

    def _iter_leaf_cases(self, node: Any) -> list[dict[str, Any]]:
        """
        Walk Allure suites tree and return leaf test-case nodes.
        Leaf nodes have fields: uid, name, status, time{start,stop,duration}.
        """
        leaves: list[dict[str, Any]] = []
        if isinstance(node, dict):
            if "uid" in node and "status" in node and "time" in node:
                leaves.append(node)
            for ch in node.get("children") or []:
                leaves.extend(self._iter_leaf_cases(ch))
        elif isinstance(node, list):
            for x in node:
                leaves.extend(self._iter_leaf_cases(x))
        return leaves

    def _fetch_case_details(self, job_name: str, build_number: int, uid: str) -> dict[str, Any] | None:
        jp = JenkinsClient.job_path(job_name)
        data = self._get_json(f"{jp}/{int(build_number)}/allure/data/test-cases/{uid}.json")
        return data if isinstance(data, dict) else None

    def _parse_allure(
        self, job_name: str, build_number: int
    ) -> list[TestRecord]:
        jp = JenkinsClient.job_path(job_name)
        suites = self._get_json(f"{jp}/{int(build_number)}/allure/data/suites.json")
        if not isinstance(suites, dict):
            return []

        leaves = self._iter_leaf_cases(suites.get("children") or [])
        if not leaves:
            return []

        records: list[TestRecord] = []
        for leaf in leaves:
            uid = str(leaf.get("uid") or "").strip()
            status = str(leaf.get("status") or "").strip().lower()
            name = str(leaf.get("name") or uid or "test").strip()
            t = leaf.get("time") or {}
            dur_ms = t.get("duration")
            start_ms = t.get("start")

            failure_message = None
            if uid and status in ("failed", "broken"):
                det = self._fetch_case_details(job_name, build_number, uid) or {}
                extracted = failure_text_from_allure_case_dict(det, max_len=8000).strip()
                if extracted:
                    failure_message = extracted[:4000]
            if failure_message is None and status in ("failed", "broken"):
                failure_message = f"Allure status={status!r} (no message/trace in report)"

            ts = None
            try:
                if start_ms:
                    ts = datetime.fromtimestamp(int(start_ms) / 1000, tz=timezone.utc)
            except Exception:
                ts = datetime.now(tz=timezone.utc)

            duration_seconds = None
            try:
                if dur_ms is not None:
                    duration_seconds = float(dur_ms) / 1000.0
            except Exception:
                duration_seconds = None

            # Map Allure statuses to our small set
            if status == "passed":
                out_status = "passed"
            elif status == "skipped":
                out_status = "skipped"
            elif status in ("failed",):
                out_status = "failed"
            elif status in ("broken",):
                out_status = "error"
            else:
                out_status = status or "unknown"

            records.append(
                TestRecord(
                    source="jenkins_allure",
                    suite=job_name,
                    test_name=name,
                    status=out_status,
                    duration_seconds=duration_seconds,
                    failure_message=failure_message,
                    timestamp=ts,
                )
            )

        return records

    def fetch_tests(self) -> list[TestRecord]:
        all_records: list[TestRecord] = []

        tasks: list[tuple[str, int]] = []
        for job_cfg in self.jobs:
            if not job_cfg.get("parse_allure", True):
                continue
            job_name = job_cfg.get("name", "")
            if not job_name:
                continue
            for build_num in self._fetch_build_numbers(job_name):
                tasks.append((job_name, int(build_num)))

        if not tasks:
            return []

        def _work(job_name: str, build_num: int) -> list[TestRecord]:
            if self.progress_cb:
                try:
                    self.progress_cb(f"Allure: {job_name} #{build_num}")
                except Exception:
                    pass
            import time
            t0 = time.monotonic()
            recs = self._parse_allure(job_name, build_num)
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            if self.timing_cb:
                try:
                    self.timing_cb({"kind": "allure", "job": job_name, "build": int(build_num), "elapsed_ms": elapsed_ms})
                except Exception:
                    pass
            if elapsed_ms >= 7000 and self.progress_cb:
                try:
                    self.progress_cb(f"Allure: slow {job_name} #{build_num} ({elapsed_ms}ms)")
                except Exception:
                    pass
            return recs

        with ThreadPoolExecutor(max_workers=self.workers) as ex:
            futs = [ex.submit(_work, job, b) for job, b in tasks]
            for fut in as_completed(futs):
                try:
                    recs = fut.result()
                except Exception as exc:
                    logger.warning("AllureParser: worker failed: %s", exc)
                    continue
                if recs:
                    if self.records_cb:
                        try:
                            self.records_cb(recs)
                        except Exception:
                            pass
                    job_name = recs[0].suite or "job"
                    failed = sum(1 for r in recs if r.status_normalized in ("failed", "error"))
                    logger.info(
                        "AllureParser: '%s' → %d test records (%d failed)",
                        job_name,
                        len(recs),
                        failed,
                    )
                all_records.extend(recs)
        return all_records

