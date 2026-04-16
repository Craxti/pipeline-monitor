"""
Jenkins Pipeline console log parser.

Looks for a "Результаты выполнения" summary block printed by pipeline
scripts and turns each line into a TestRecord.

Expected console format (printed via `echo`):
    ====== 📋 Результаты выполнения ======
    №114 Создание OIM интеграции: ✅ Успешно
    №29  Кластеризации DBSCAN:     ❌ Ошибка: test_29 #20 completed with status UNSTABLE ...
"""

from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import requests

from models.models import TestRecord
from clients.jenkins_client import JenkinsClient

logger = logging.getLogger(__name__)

# Strip "[Pipeline] echo" prefix that Jenkins injects into every echo call
_PIPELINE_PREFIX = re.compile(r"^\[Pipeline\]\s+\S+\s*")

# Results section header — tolerant to emojis and whitespace
_HEADER_RE = re.compile(r"Результаты\s+выполнения", re.IGNORECASE)

# Passed line:  №N <name>: ... Успешно
_PASSED_RE = re.compile(r"^(№\d+\s+.+?):\s+.*Успешно", re.UNICODE)

# Failed line:  №N <name>: ... Ошибка: <message>
_FAILED_RE = re.compile(r"^(№\d+\s+.+?):\s+.*Ошибка[:\s]+(.+)", re.UNICODE)

# Pytest short summary block:
#   =================== short test summary info ====================
#   FAILED tests/test_foo.py::test_bar - AssertionError: ...
_PYTEST_SUMMARY_HDR_RE = re.compile(r"short\s+test\s+summary\s+info", re.IGNORECASE)
_PYTEST_SUMMARY_LINE_RE = re.compile(r"^(FAILED|ERROR)\s+(.+)$")
# FAILED / ERROR lines anywhere in the log (not only in the summary block)
_PYTEST_FAIL_LINE_RE = re.compile(r"^(FAILED|ERROR)\s+(.+)$")
# Pytest failure section header: ________ test_name ________
_PYTEST_SECTION_HDR_RE = re.compile(r"^_{3,}\s*(.+?)\s*_{3,}\s*$")
# Jenkins echo line often reports: test_27_foo #23 completed with status UNSTABLE
_PIPELINE_TEST_ID_IN_NOISE_RE = re.compile(
    r"\b((?:test_\d+[\w_]+)|(?:test_gu_FS_[\w]+))\s+#\d+\s+completed\b",
    re.IGNORECASE,
)

_FAILURE_MSG_MAX = 4000


def _failure_msg_is_jenkins_noise(msg: str | None) -> bool:
    if not msg or not str(msg).strip():
        return True
    low = str(msg).lower()
    needles = (
        "completed with status unstable",
        "completed with status failure",
        "propagate: false",
        "failed to trigger build",
    )
    return any(n in low for n in needles)


def _strip_pipeline_echo(line: str) -> str:
    return _PIPELINE_PREFIX.sub("", line).strip()


def _collect_pytest_e_lines(lines: list[str], start: int, *, max_lines: int = 48) -> tuple[str, int]:
    """Gather consecutive 'E   ' assertion lines after a failure; return (joined, next_index)."""
    parts: list[str] = []
    j = start
    while j < len(lines) and j < start + max_lines:
        raw = lines[j]
        s = raw.strip()
        if s.startswith("E   "):
            parts.append(s[4:].strip())
            j += 1
            continue
        if parts and not s:
            j += 1
            continue
        if parts:
            break
        j += 1
    return (" ".join(parts).strip(), j)


def extract_pytest_failure_messages(console_text: str, *, max_each: int = _FAILURE_MSG_MAX) -> dict[str, str]:
    """
    Build map: pytest function name (last segment after ::) -> best failure text
    from FAILED/ERROR lines and following E-lines, plus ______ test ______ sections.
    """
    raw_lines = console_text.splitlines()
    lines = [_strip_pipeline_echo(x) for x in raw_lines]
    by_fn: dict[str, str] = {}
    n = len(lines)
    i = 0
    while i < n:
        line = lines[i]
        msec = _PYTEST_SECTION_HDR_RE.match(line)
        if msec:
            title = msec.group(1).strip()
            fn = title.split("::")[-1] if title else ""
            j = i + 1
            chunk_end = min(n, i + 140)
            e_parts: list[str] = []
            while j < chunk_end:
                s = lines[j]
                if _PYTEST_SECTION_HDR_RE.match(s) or (s.startswith("=") and len(s) > 20):
                    break
                if s.startswith("E   "):
                    e_parts.append(s[4:].strip())
                j += 1
            if fn and e_parts:
                msg = " ".join(e_parts)[:max_each]
                if fn not in by_fn or len(msg) > len(by_fn[fn]):
                    by_fn[fn] = msg
            i = j
            continue

        mfail = _PYTEST_FAIL_LINE_RE.match(line)
        if mfail:
            rest = mfail.group(2).strip()
            test_id = rest
            short_msg = ""
            if " - " in rest:
                test_id, short_msg = rest.split(" - ", 1)
                test_id, short_msg = test_id.strip(), short_msg.strip()
            fn = test_id.split("::")[-1] if test_id else ""
            merged = short_msg
            elines, _ = _collect_pytest_e_lines(lines, i + 1)
            if elines:
                merged = f"{short_msg}\n{elines}".strip() if short_msg else elines
            if fn and merged:
                merged = merged[:max_each]
                if fn not in by_fn or len(merged) > len(by_fn[fn]):
                    by_fn[fn] = merged
            i += 1
            continue
        i += 1
    return by_fn


def enrich_jenkins_console_failure_messages(records: list[TestRecord], console_text: str) -> None:
    """Replace Jenkins UNSTABLE/noise messages with pytest details when we can map rows."""
    pytest_map = extract_pytest_failure_messages(console_text)
    if not pytest_map:
        return
    for rec in records:
        if rec.status not in ("failed", "error"):
            continue
        if not _failure_msg_is_jenkins_noise(rec.failure_message):
            continue
        msg = rec.failure_message or ""
        candidates: list[str] = []
        m_pid = _PIPELINE_TEST_ID_IN_NOISE_RE.search(msg)
        if m_pid:
            candidates.append(m_pid.group(1))
        m_no = re.search(r"\N{NUMERO SIGN}\s*(\d+)", rec.test_name or "")
        if m_no:
            num = m_no.group(1)
            for fn in pytest_map:
                if fn == f"test_{num}" or fn.startswith(f"test_{num}_"):
                    candidates.append(fn)
        seen: set[str] = set()
        chosen = ""
        for c in candidates:
            if c in seen:
                continue
            seen.add(c)
            pm = pytest_map.get(c)
            if pm and len(pm) > len(chosen):
                chosen = pm
        if chosen:
            rec.failure_message = chosen[:_FAILURE_MSG_MAX]


class JenkinsConsoleParser:
    """
    Fetches Jenkins build console logs via the REST API and parses
    the pipeline results summary into TestRecord objects.

    One TestRecord is emitted per test scenario per build, so repeated
    failures across N builds will accumulate to count=N in top-failures.
    """

    def __init__(
        self,
        url: str,
        username: str,
        token: str,
        jobs: list[dict],
        max_builds: int = 5,
        workers: int = 8,
        timeout: int = 20,
        verify_ssl: bool = True,
        retries: int = 3,
        backoff_seconds: float = 0.8,
        records_cb: callable | None = None,
        progress_cb: callable | None = None,
        timing_cb: callable | None = None,
    ) -> None:
        self.base_url = url.rstrip("/")
        self.auth = (username, token)
        self.jobs = jobs
        self.max_builds = max_builds
        self.workers = max(1, int(workers or 1))
        self.timeout = timeout
        self.verify_ssl = verify_ssl
        self.retries = max(0, int(retries or 0))
        self.backoff_seconds = max(0.0, float(backoff_seconds or 0.0))
        self.records_cb = records_cb
        self.progress_cb = progress_cb
        self.timing_cb = timing_cb

    # ── private helpers ───────────────────────────────────────────────────

    def _should_retry_status(self, status_code: int | None) -> bool:
        return status_code in (408, 425, 429, 500, 502, 503, 504)

    def _get_with_retry(self, url: str) -> requests.Response | None:
        """
        Best-effort GET with exponential backoff for transient Jenkins overload (429/5xx).
        """
        attempt = 0
        while True:
            try:
                import time
                t0 = time.monotonic()
                r = requests.get(url, auth=self.auth, timeout=self.timeout, verify=self.verify_ssl)
                elapsed_ms = int((time.monotonic() - t0) * 1000)
                if r.status_code >= 400 and self._should_retry_status(r.status_code) and attempt < self.retries:
                    delay = self.backoff_seconds * (2 ** attempt)
                    logger.warning("ConsoleParser: %s -> %d (%dms), retry in %.1fs", url, r.status_code, elapsed_ms, delay)
                    try:
                        time.sleep(delay)
                    except Exception:
                        pass
                    attempt += 1
                    continue
                r.raise_for_status()
                return r
            except requests.HTTPError as exc:
                code = getattr(getattr(exc, "response", None), "status_code", None)
                if code is not None and self._should_retry_status(code) and attempt < self.retries:
                    delay = self.backoff_seconds * (2 ** attempt)
                    logger.warning("ConsoleParser: HTTP %s (%s), retry in %.1fs", url, code, delay)
                    try:
                        import time
                        time.sleep(delay)
                    except Exception:
                        pass
                    attempt += 1
                    continue
                return None
            except Exception:
                if attempt < self.retries:
                    delay = self.backoff_seconds * (2 ** attempt)
                    logger.warning("ConsoleParser: GET failed, retry in %.1fs: %s", delay, url)
                    try:
                        import time
                        time.sleep(delay)
                    except Exception:
                        pass
                    attempt += 1
                    continue
                return None

    def _fetch_build_numbers(self, job_name: str) -> list[int]:
        jp = JenkinsClient.job_path(job_name)
        # max_builds <= 0 means "no explicit limit" (Jenkins decides how many to return).
        if int(self.max_builds) <= 0:
            url = f"{self.base_url}{jp}/api/json?tree=builds[number]"
        else:
            url = f"{self.base_url}{jp}/api/json?tree=builds[number]{{0,{int(self.max_builds)}}}"
        try:
            r = self._get_with_retry(url)
            if not r:
                if self.progress_cb:
                    try:
                        self.progress_cb(f"Console: {job_name} build list fetch failed")
                    except Exception:
                        pass
                return []
            return [b["number"] for b in (r.json().get("builds", []) or []) if "number" in b]
        except Exception as exc:
            logger.warning("ConsoleParser: cannot list builds for '%s': %s", job_name, exc)
            if self.progress_cb:
                try:
                    self.progress_cb(f"Console: {job_name} build list error: {str(exc)[:160]}")
                except Exception:
                    pass
            return []

    def _fetch_console(self, job_name: str, build_number: int) -> str:
        jp = JenkinsClient.job_path(job_name)
        url = f"{self.base_url}{jp}/{build_number}/consoleText"
        try:
            r = self._get_with_retry(url)
            if r is None:
                if self.progress_cb:
                    try:
                        self.progress_cb(f"Console: {job_name} #{build_number} fetch failed")
                    except Exception:
                        pass
                return ""
            return r.text
        except Exception as exc:
            logger.warning(
                "ConsoleParser: cannot fetch console %s #%d: %s", job_name, build_number, exc
            )
            if self.progress_cb:
                try:
                    self.progress_cb(f"Console: {job_name} #{build_number} error: {str(exc)[:160]}")
                except Exception:
                    pass
            return ""

    def _fetch_build_started_at(self, job_name: str, build_number: int) -> datetime | None:
        """Jenkins build `timestamp` (ms since epoch) for accurate lookback filters / top-failures."""
        jp = JenkinsClient.job_path(job_name)
        url = f"{self.base_url}{jp}/{int(build_number)}/api/json?tree=timestamp"
        try:
            r = self._get_with_retry(url)
            if not r:
                return None
            j = r.json()
            ts_ms = j.get("timestamp")
            if ts_ms is None:
                return None
            return datetime.fromtimestamp(int(ts_ms) / 1000.0, tz=timezone.utc)
        except Exception:
            return None

    def _parse_console(
        self,
        text: str,
        job_name: str,
        build_number: int,
        *,
        record_ts: datetime,
    ) -> list[TestRecord]:
        records: list[TestRecord] = []
        in_results = False
        in_pytest_summary = False
        ts = record_ts

        for raw_line in text.splitlines():
            # Remove Jenkins "[Pipeline] echo" prefix
            line = _PIPELINE_PREFIX.sub("", raw_line).strip()

            # Fallback: parse pytest "short test summary info" block.
            # We only emit failed/error records to keep volume small.
            if not in_results:
                if _PYTEST_SUMMARY_HDR_RE.search(line):
                    in_pytest_summary = True
                    continue
                if in_pytest_summary:
                    mps = _PYTEST_SUMMARY_LINE_RE.match(line)
                    if mps:
                        kind = mps.group(1).strip().lower()
                        rest = mps.group(2).strip()
                        test_id = rest
                        msg = None
                        if " - " in rest:
                            test_id, msg = rest.split(" - ", 1)
                        records.append(TestRecord(
                            source="jenkins_console",
                            suite=job_name,
                            test_name=test_id.strip(),
                            status="error" if kind == "error" else "failed",
                            failure_message=(msg or "").strip()[:_FAILURE_MSG_MAX] if msg else None,
                            timestamp=ts,
                        ))
                        continue
                    # Stop when we hit the final summary/footer separators
                    if line.startswith("===") or line.startswith("FAILED") or line.startswith("ERROR"):
                        continue
                    if not line and records:
                        # after some summary lines, blank usually indicates end
                        in_pytest_summary = False

            if not in_results:
                if _HEADER_RE.search(line):
                    in_results = True
                continue

            # Passed
            m = _PASSED_RE.match(line)
            if m:
                records.append(TestRecord(
                    source="jenkins_console",
                    suite=job_name,
                    test_name=m.group(1).strip(),
                    status="passed",
                    timestamp=ts,
                ))
                continue

            # Failed / error
            m = _FAILED_RE.match(line)
            if m:
                records.append(TestRecord(
                    source="jenkins_console",
                    suite=job_name,
                    test_name=m.group(1).strip(),
                    status="failed",
                    failure_message=m.group(2).strip()[:_FAILURE_MSG_MAX],
                    timestamp=ts,
                ))

        enrich_jenkins_console_failure_messages(records, text)
        return records

    # ── public API ────────────────────────────────────────────────────────

    def fetch_tests(self) -> list[TestRecord]:
        """
        For each job that has ``parse_console: true`` (default), fetch
        the last ``max_builds`` console logs and parse test results.
        """
        all_records: list[TestRecord] = []

        tasks: list[tuple[str, int]] = []
        for job_cfg in self.jobs:
            if not job_cfg.get("parse_console", True):
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
                    self.progress_cb(f"Console: {job_name} #{build_num}")
                except Exception:
                    pass
            import time
            t0 = time.monotonic()
            console = self._fetch_console(job_name, build_num)
            if not console:
                return []
            bts = self._fetch_build_started_at(job_name, build_num)
            rec_ts = bts if bts is not None else datetime.now(tz=timezone.utc)
            recs = self._parse_console(console, job_name, build_num, record_ts=rec_ts)
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            if self.timing_cb:
                try:
                    self.timing_cb({"kind": "console", "job": job_name, "build": int(build_num), "elapsed_ms": elapsed_ms})
                except Exception:
                    pass
            # Also surface very slow operations in progress log.
            if elapsed_ms >= 5000 and self.progress_cb:
                try:
                    self.progress_cb(f"Console: slow {job_name} #{build_num} ({elapsed_ms}ms)")
                except Exception:
                    pass
            return recs

        with ThreadPoolExecutor(max_workers=self.workers) as ex:
            futs = [ex.submit(_work, job, b) for job, b in tasks]
            for fut in as_completed(futs):
                try:
                    records = fut.result()
                except Exception as exc:
                    logger.warning("ConsoleParser: worker failed: %s", exc)
                    continue
                if records:
                    if self.records_cb:
                        try:
                            self.records_cb(records)
                        except Exception:
                            pass
                    # Log one line per parsed build (keeps UI snappy even with many tasks)
                    job_name = records[0].suite or "job"
                    failed = sum(1 for r in records if r.status == "failed")
                    logger.info(
                        "ConsoleParser: '%s' → %d test records (%d failed)",
                        job_name,
                        len(records),
                        failed,
                    )
                all_records.extend(records)

        return all_records
