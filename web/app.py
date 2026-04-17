"""
FastAPI web interface for CI/CD Monitor.

Run with:  uvicorn web.app:app --host 0.0.0.0 --port 8080 --reload
Or via:    python ci_monitor.py web
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
import threading
import time
from collections import Counter
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from starlette.staticfiles import StaticFiles


from web.routes.builds import router as _builds_router
from web.routes.chat import router as _chat_router
from web.routes.collect import router as _collect_router
from web.routes.incident import router as _incident_router
from web.routes.ops import router as _ops_router
from web.routes.services import router as _services_router
from web.routes.settings import router as _settings_router
from web.routes.tests import router as _tests_router

from models.models import (
    CISnapshot,
    TestRecord,
    normalize_build_status,
    normalize_service_status,
    normalize_test_status,
)

from web.schemas import MonitorGeneralConfig

from web.core.paths import REPO_ROOT as _REPO_ROOT
from web.core.config import config_yaml_path as _config_yaml_path, load_yaml_config as _load_yaml_config
from web.core.auth import require_shared_token
from web.core.settings_secrets import (
    SETTINGS_SECRET_MASK as _SETTINGS_SECRET_MASK,
    mask_settings_for_response as _mask_settings_for_response,
    merge_settings_secrets as _merge_settings_secrets,
)
from web.core import snapshot_cache as _snapshot_cache_mod

logger = logging.getLogger(__name__)

# Bumped when API surface changes; visible in /api/chat/status so you know the process reloaded.
_APP_BUILD = "2026-04-03+multi-telegram-ollama"

# Shown when provider=cursor but no agent binary/bundle was resolved (before calling the proxy).
CURSOR_AGENT_UNAVAILABLE_MSG = (
    "Cursor Agent не найден на этом компьютере (ни в PATH, ни в настройке «Путь к Cursor Agent», "
    "ни после авто-поиска по типичным папкам). Без отдельного пакета Cursor Agent CLI чат через "
    "cursor-api-proxy работать не будет — редактор Cursor его не подставляет. "
    "Варианты: установить CLI по документации https://cursor.com/docs/cli/overview , "
    "либо указать каталог с agent.cmd + node.exe + index.js в Настройках → AI, "
    "либо переключить провайдера на Gemini или OpenRouter. Лог: data/cursor_proxy.log"
)

_cursor_agent_resolve_cache: tuple[float, str | None] | None = None

# SQLite layer (optional, initialized in lifespan)
try:
    from web.db import (
        init_db,
        append_snapshot as _db_append,
        db_stats,
        service_uptime as _db_svc_uptime,
        build_duration_history as _db_build_duration,
        flaky_analysis as _db_flaky_analysis,
        query_builds_history as _db_query_builds_history,
    )
    _SQLITE_AVAILABLE = True
except ImportError:
    try:
        from db import (
            init_db,
            append_snapshot as _db_append,
            db_stats,
            service_uptime as _db_svc_uptime,
            build_duration_history as _db_build_duration,
            flaky_analysis as _db_flaky_analysis,
            query_builds_history as _db_query_builds_history,
        )
        _SQLITE_AVAILABLE = True
    except ImportError:
        _SQLITE_AVAILABLE = False
        _db_build_duration = None  # type: ignore
        _db_flaky_analysis = None  # type: ignore
        _db_query_builds_history = None  # type: ignore
        logger.debug("SQLite module (db.py) not found — running without persistent history")

# ── data helpers ──────────────────────────────────────────────────────────
_TEMPLATES_DIR = Path(__file__).parent / "templates"
templates = Jinja2Templates(directory=str(_TEMPLATES_DIR))
_DATA_FILE = _snapshot_cache_mod.SNAPSHOT_PATH
from web.core import event_feed as _event_feed_mod
from web.core import trends as _trends_mod

from web.services.build_filters import (
    config_instance_label as _config_instance_label,
    inst_label_for_build_with_cfg as _inst_label_for_build_with_cfg,
    is_snapshot_build_enabled as _is_snapshot_build_enabled,
)
from web.services import tests_analytics as _tests_analytics
from web.services import build_analytics as _build_analytics
from web.services import trends_uptime as _trends_uptime
from web.services import correlation as _correlation
from web.services import exports as _exports
from web.services.notification_state import NotificationState as _NotificationState
from web.services.collect_state import CollectState as _CollectState
from web.services import collect_api as _collect_api
from web.services import collect_triggers as _collect_triggers
from web.services import settings_api as _settings_api
from web.services import ops_actions as _ops_actions
from web.services import logs_api as _logs_api
from web.services import webhooks as _webhooks
from web.services import ai_helpers as _ai_helpers
from web.services import cursor_proxy as _cursor_proxy
from web.services import runtime_helpers as _runtime_helpers
from web.services import event_feed_api as _event_feed_api
from web.services import sse_hub as _sse_hub
from web.services import collect_loop as _collect_loop_mod

_EVENT_FEED_FILE = _event_feed_mod.EVENT_FEED_PATH
_EVENT_FEED_MAX = _event_feed_mod.EVENT_FEED_MAX


_HISTORY_FILE = _trends_mod.HISTORY_PATH
_HISTORY_MAX_DAYS = _trends_mod.HISTORY_MAX_DAYS


def _append_trends(snapshot: CISnapshot) -> None:
    return _trends_mod.append_trends(
        snapshot,
        history_path=_HISTORY_FILE,
        history_max_days=_HISTORY_MAX_DAYS,
        load_cfg=_load_yaml_config,
        inst_label_for_build=_inst_label_for_build_with_cfg,
    )


def save_snapshot(snapshot: CISnapshot) -> None:
    global _data_revision
    with _snapshot_write_lock:
        _DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        _DATA_FILE.write_text(
            snapshot.model_dump_json(indent=2), encoding="utf-8"
        )
        _data_revision += 1
        try:
            mtime = _DATA_FILE.stat().st_mtime
        except OSError:
            mtime = None
        _prime_snapshot_cache(snapshot, mtime)
    try:
        _append_trends(snapshot)
    except Exception as exc:
        logger.warning("Failed to append trends: %s", exc)
    try:
        _detect_state_changes(snapshot)
    except Exception as exc:
        logger.warning("Failed to detect state changes: %s", exc)
    # Write to SQLite for historical queries (non-blocking, best-effort)
    if _SQLITE_AVAILABLE:
        try:
            _db_append(snapshot)
        except Exception as exc:
            logger.debug("SQLite append skipped: %s", exc)


_snapshot_write_lock = threading.Lock()
_partial_last_write_ts: float = 0.0


def save_snapshot_partial(snapshot: CISnapshot) -> None:
    """
    Persist an in-progress snapshot for live dashboard updates during Collect.
    Intentionally skips trends/notifications/DB to keep it cheap.
    """
    global _data_revision
    # Do not publish a snapshot that wipes tests on disk while a collect is still running
    # and the previous file still had rows — the UI would flash empty (incremental collect
    # clears tests in memory before parsers repopulate).
    try:
        if _collect_state.get("is_collecting"):
            n_new = len(getattr(snapshot, "tests", None) or [])
            if n_new == 0:
                prev = _load_snapshot()
                if prev is not None and len(prev.tests or []) > 0:
                    return
    except Exception:
        pass
    with _snapshot_write_lock:
        _DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        _DATA_FILE.write_text(snapshot.model_dump_json(indent=2), encoding="utf-8")
        _data_revision += 1
        try:
            mtime = _DATA_FILE.stat().st_mtime
        except OSError:
            mtime = None
        _prime_snapshot_cache(snapshot, mtime)


def _maybe_save_partial(snapshot: CISnapshot, *, min_interval_s: float = 2.0, force: bool = False) -> None:
    global _partial_last_write_ts
    now = time.monotonic()
    if not force and (now - _partial_last_write_ts) < float(min_interval_s):
        return
    _partial_last_write_ts = now
    try:
        save_snapshot_partial(snapshot)
    except Exception as exc:
        logger.debug("Partial snapshot save skipped: %s", exc)


def _public_settings_payload(cfg: dict) -> dict:
    """Minimal non-secret fields for UI bootstrapping."""
    g = cfg.get("general") or {}
    w = cfg.get("web") or {}
    sqlite_ok = False
    if _SQLITE_AVAILABLE:
        try:
            st = db_stats()
            sqlite_ok = bool(st.get("enabled"))
        except Exception:
            sqlite_ok = False
    return {
        "ui_language": g.get("ui_language", "en"),
        "project_name": g.get("project_name", "CI/CD Monitor"),
        "web": {
            "host": w.get("host", "0.0.0.0"),
            "port": int(w.get("port", 8000)),
            "auto_collect": w.get("auto_collect", True),
            "collect_interval_seconds": int(w.get("collect_interval_seconds", 300)),
            "live_reload": w.get("live_reload", True),
        },
        "sqlite_enabled": sqlite_ok,
    }


# ── background collection state ───────────────────────────────────────────

# Single runtime container for collect status + logs.
_collect_rt = _CollectState()
_collect_state = _collect_rt.state
_collect_logs = _collect_rt.logs
_collect_slow = _collect_rt.slow


def _push_collect_log(phase: str, main: str, sub: str | None = None, level: str = "info") -> None:
    return _collect_rt.push_log(phase, main, sub, level)
# Last collect: per-source health (Jenkins / GitLab / Docker monitor)
_instance_health: list[dict[str, Any]] = []
_collect_task: asyncio.Task | None = None
# Server-side switch for the background auto-collect loop.
# We tie it to the UI LIVE mode so when LIVE is off there is no auto-collect.
_auto_collect_enabled: bool = False
_auto_collect_enabled_at_iso: str | None = None

# Bumped on each successful save_snapshot — ETag / cache invalidation / SSE clients
_data_revision: int = 0
_snapshot_cache_mod.set_snapshot_revision_accessor(lambda: _data_revision)
_load_snapshot = _snapshot_cache_mod.load_snapshot
_load_snapshot_async = _snapshot_cache_mod.load_snapshot_async
_prime_snapshot_cache = _snapshot_cache_mod.prime_snapshot_cache
_main_loop: asyncio.AbstractEventLoop | None = None
_sse_queues: set[asyncio.Queue] = set()
_MEM_CACHE: dict[str, tuple[float, Any]] = {}
_MEM_CACHE_TTL_SEC = 20.0


def _mem_cache_get(key: str) -> Any | None:
    ent = _MEM_CACHE.get(key)
    if not ent:
        return None
    exp, val = ent
    if time.monotonic() > exp:
        del _MEM_CACHE[key]
        return None
    return val


def _mem_cache_set(key: str, val: Any, ttl: float = _MEM_CACHE_TTL_SEC) -> None:
    _MEM_CACHE[key] = (time.monotonic() + ttl, val)


async def _sse_broadcast_async(payload: dict) -> None:
    return await _sse_hub.broadcast_async(_sse_queues, payload)


def _status_str(b: object) -> str:
    return _build_analytics.status_str(b)


def _job_build_analytics(snapshot: CISnapshot) -> dict[str, dict]:
    return _build_analytics.job_build_analytics(snapshot)


def _correlation_last_hour() -> dict:
    return _correlation.correlation_last_hour(
        load_snapshot=_load_snapshot,
        load_events=_event_feed_load,
        events_limit=500,
    )


def _trends_compute(days: int) -> list:
    return _trends_uptime.trends_compute(days, history_path=_HISTORY_FILE)


def _uptime_compute(days: int) -> dict:
    return _trends_uptime.uptime_compute(
        days,
        history_path=_HISTORY_FILE,
        sqlite_available=_SQLITE_AVAILABLE,
        db_svc_uptime=_db_svc_uptime if _SQLITE_AVAILABLE else None,
    )

# ── Embedded cursor-api-proxy (Node / npx) ────────────────────────────────

def _cursor_proxy_autostart_enabled(cfg: dict) -> bool:
    return _cursor_proxy.cursor_proxy_autostart_enabled(cfg)


def _cursor_proxy_should_run(cfg: dict) -> bool:
    return _cursor_proxy.cursor_proxy_should_run(cfg)


def _resolve_cursor_agent_cached(cfg: dict) -> str | None:
    return _cursor_proxy.resolve_cursor_agent_cached(cfg)


def _shutdown_embedded_cursor_proxy() -> None:
    return _cursor_proxy.shutdown_embedded_cursor_proxy()


def sync_cursor_proxy_from_config(cfg: dict) -> dict:
    return _cursor_proxy.sync_cursor_proxy_from_config(cfg)


def _cursor_proxy_running() -> bool:
    return _cursor_proxy.cursor_proxy_running()


# ── Rate limiting (action endpoints) ─────────────────────────────────────
_rate_limit_store: dict[str, float] = {}
_RATE_LIMIT_SECONDS = 15


def _check_rate_limit(key: str, window: float = _RATE_LIMIT_SECONDS) -> None:
    return _runtime_helpers.check_rate_limit(_rate_limit_store, key, window=window)


# ── State-change notifications ────────────────────────────────────────────
_notify_state = _NotificationState(notify_max=200)


def _event_feed_slim(entry: dict) -> dict:
    return _event_feed_api.slim(entry)


def _event_feed_append(entries: list[dict]) -> None:
    return _event_feed_api.append(entries, path=_EVENT_FEED_FILE, max_entries=_EVENT_FEED_MAX)


def _event_feed_load(limit: int = 300) -> list[dict]:
    return _event_feed_api.load(limit=limit, path=_EVENT_FEED_FILE)


def _detect_state_changes(snapshot: "CISnapshot") -> None:
    _notify_state.apply(snapshot, append_event=_event_feed_append)


def _run_collect_sync(cfg: dict, *, force_full: bool = False) -> None:
    """Full collection — runs in a thread-pool executor (blocking)."""
    from clients.jenkins_client import JenkinsClient
    from parsers.pytest_parser import PytestXMLParser
    from parsers.allure_parser import AllureJsonParser
    from docker_monitor.monitor import DockerMonitor
    from web.db import get_collector_state_int, set_collector_state_int

    since = datetime.now(tz=timezone.utc) - timedelta(
        days=cfg.get("general", {}).get("default_lookback_days", 7)
    )
    now = datetime.now(tz=timezone.utc)
    if force_full:
        snapshot = CISnapshot(collected_at=now, collect_meta={}, tests=[])
    else:
        prev = _load_snapshot() or CISnapshot()
        # Shallow copy: do not mutate the object returned from _load_snapshot() cache.
        # Fresh `tests` each collect avoids appending duplicates across runs.
        snapshot = prev.model_copy(
            update={
                "tests": [],
                "collect_meta": {},
                "collected_at": now,
            }
        )
    snap_lock = threading.Lock()
    global _instance_health
    health: list[dict[str, Any]] = []

    def _append_tests_live(recs: list[TestRecord]) -> None:
        if not recs:
            return
        with snap_lock:
            snapshot.tests.extend(recs)
        _maybe_save_partial(snapshot)

    def _progress(phase: str, main: str, sub: str | None = None) -> None:
        # This runs in a worker thread; updates are best-effort for UI polling.
        _collect_state["phase"] = phase
        _collect_state["progress_main"] = main
        _collect_state["progress_sub"] = sub
        _collect_state["progress_counts"] = {
            "builds": len(snapshot.builds),
            "tests": len(snapshot.tests),
            "services": len(snapshot.services),
        }
        # Heuristic: mark obvious failures as warn to make log filtering useful.
        lvl = "info"
        s = (sub or "").lower()
        if " error" in s or "failed" in s or "exception" in s or "traceback" in s or "retry" in s:
            lvl = "warn"
        _push_collect_log(phase, main, sub, lvl)

    def _build_key(b: object) -> str:
        try:
            bn = getattr(b, "build_number", None)
            inst_l = getattr(b, "source_instance", None) or ""
            return f"{getattr(b,'source','')}|{inst_l}|{getattr(b,'job_name','')}|{bn}|{getattr(b,'url','') or ''}"
        except Exception:
            return str(id(b))

    def _merge_build_records(new_records: list) -> None:
        if not new_records:
            return
        existing = snapshot.builds or []
        existing_by_key = {_build_key(b): b for b in existing}
        for b in new_records:
            existing_by_key[_build_key(b)] = b
        merged = list(existing_by_key.values())
        # Sort newest-first when possible
        try:
            merged.sort(key=lambda x: getattr(x, "started_at", None) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        except Exception:
            pass
        snapshot.builds = merged

    for inst in cfg.get("jenkins_instances", []):
        if not inst.get("enabled", True):
            continue
        label = inst.get("name", inst.get("url", "Jenkins"))
        inst_key = _config_instance_label(inst, kind="jenkins")
        shared_discovered: list[str] = []
        n_console_jobs_parsed = 0
        n_allure_jobs_parsed = 0
        t0 = time.monotonic()
        try:
            verify_ssl = bool(inst.get("verify_ssl", True))
            _progress("jenkins_builds", f"Jenkins: {label}", "Preparing job list…")

            # show_all_limit_jobs:
            # - absent -> safe default (50)
            # - <= 0  -> unlimited (None)
            _raw_limit = inst.get("show_all_limit_jobs", 50)
            try:
                _raw_limit = int(_raw_limit)
            except Exception:
                _raw_limit = 50
            show_all_limit_jobs = None if (_raw_limit is not None and int(_raw_limit) <= 0) else int(_raw_limit)

            client = JenkinsClient(
                url=inst["url"],
                username=inst.get("username", ""),
                token=inst.get("token", ""),
                jobs=inst.get("jobs", []),
                timeout=15,
                show_all=inst.get("show_all_jobs", False),
                show_all_limit_jobs=(
                    show_all_limit_jobs
                    if inst.get("show_all_jobs", False) and not inst.get("jobs") and show_all_limit_jobs is not None
                    else None
                ),
                verify_ssl=verify_ssl,
                progress_cb=lambda msg: _progress("jenkins_builds", f"Jenkins: {label}", msg),
                source_instance=inst_key,
            )
            if inst.get("show_all_jobs", False):
                try:
                    shared_discovered = client.fetch_job_list() or []
                except Exception as exc:
                    logger.warning("Jenkins [%s] fetch_job_list failed: %s", label, exc)
                    shared_discovered = []
            # max_builds: 0 means "unlimited" (no explicit limit in Jenkins request).
            try:
                effective_max_builds = int(inst.get("max_builds", 10))
            except Exception:
                effective_max_builds = 10
            if inst.get("show_all_jobs", False) and not inst.get("jobs"):
                cap = int(inst.get("show_all_max_builds", 20) or 20)
                if cap > 0:
                    effective_max_builds = min(effective_max_builds, cap)
            # Fast path: when show_all_jobs is enabled, fetch the latest status for many jobs in ONE request.
            if inst.get("show_all_jobs", False):
                limit_jobs = show_all_limit_jobs if (inst.get("show_all_jobs", False) and not inst.get("jobs")) else None
                _progress(
                    "jenkins_builds",
                    f"Jenkins: {label}",
                    f"Fetching lastBuild (bulk)… (limit_jobs={limit_jobs or 'all'})",
                )
                bulk_builds = client.fetch_last_builds_bulk(
                    since=since,
                    limit_jobs=limit_jobs,
                    depth=int(inst.get("show_all_depth", 4) or 4),
                )
                _merge_build_records(bulk_builds)
                # Bulk returns only lastCompletedBuild per job; optionally pull recent history per job.
                hist_n = int(inst.get("show_all_history_builds", 0) or 0)
                hist_job_cap = int(inst.get("show_all_history_jobs_cap", 45) or 45)
                if hist_n > 0 and bulk_builds:
                    crit_by: dict[str, bool] = {}
                    for j in inst.get("jobs") or []:
                        jn = (j.get("name") or "").strip()
                        if jn:
                            crit_by[jn] = bool(j.get("critical", False))
                    _progress(
                        "jenkins_builds",
                        f"Jenkins: {label}",
                        f"Fetching build history (≤{hist_n} builds/job, up to {hist_job_cap} jobs)…",
                    )
                    seen_hist: set[str] = set()
                    n_hist = 0
                    for b in bulk_builds:
                        if n_hist >= max(1, hist_job_cap):
                            break
                        jn = getattr(b, "job_name", None) or ""
                        if not jn or jn in seen_hist:
                            continue
                        if getattr(b, "build_number", None) is None:
                            continue
                        seen_hist.add(jn)
                        n_hist += 1
                        short = jn.rsplit("/", 1)[-1]
                        crit = bool(crit_by.get(jn) or crit_by.get(short))
                        try:
                            extra_hist = client.fetch_builds_for_job(
                                jn, since=since, max_builds=hist_n, critical=crit
                            )
                            if extra_hist:
                                _merge_build_records(extra_hist)
                        except Exception as exc:
                            logger.debug("Jenkins history fetch for %s: %s", jn, exc)
                # If /api/json?tree=jobs[name] (fetch_job_list) failed but bulk succeeded,
                # derive a stable "discovered jobs" list from the bulk payload so console/allure
                # parsing can still work and meta doesn't show "~0 jobs in index".
                if inst.get("show_all_jobs", False) and (not shared_discovered) and bulk_builds:
                    try:
                        shared_discovered = [b.job_name for b in bulk_builds if getattr(b, "job_name", None)]
                    except Exception:
                        shared_discovered = []
                # Build a quick status index for later (console/allure selection).
                last_status_by_job: dict[str, str] = {}
                for b in bulk_builds:
                    try:
                        last_status_by_job[b.job_name] = b.status_normalized
                    except Exception:
                        pass
                # Persist "last seen build number" per job for incremental collection.
                if _SQLITE_AVAILABLE and not force_full:
                    try:
                        base = str(inst.get("url", "")).rstrip("/")
                        for b in bulk_builds:
                            if not b.build_number:
                                continue
                            k = f"jenkins|{base}|{b.job_name}"
                            prev = get_collector_state_int(k, 0)
                            if int(b.build_number) > int(prev):
                                set_collector_state_int(k, int(b.build_number))
                    except Exception:
                        pass
                # Fallback "tests" derived from build results:
                # Many Jenkins jobs run exactly one test (-k=<job>) and console output
                # doesn't contain a stable per-test record for "passed". To keep the Tests tab
                # and Top failures populated even when console/allure parsing yields 0 records,
                # we emit one synthetic TestRecord per job build here.
                try:
                    for b in bulk_builds:
                        st = b.status_normalized
                        if st not in ("success", "failure", "unstable", "aborted"):
                            continue
                        t_status = "passed" if st == "success" else "failed" if st in ("failure", "unstable") else "skipped"
                        snapshot.tests.append(TestRecord(
                            source="jenkins_build",
                            source_instance=getattr(b, "source_instance", None) or inst_key,
                            suite=b.job_name,
                            test_name=b.job_name,
                            status=t_status,
                            duration_seconds=b.duration_seconds,
                            failure_message=None,
                            timestamp=b.started_at,
                        ))
                except Exception:
                    pass
                # Single write after builds + synthetic tests so the file never briefly holds tests=[].
                _maybe_save_partial(snapshot, force=True)
            else:
                _progress("jenkins_builds", f"Jenkins: {label}", f"Fetching builds… (max_builds={effective_max_builds})")
                _merge_build_records(
                    client.fetch_builds(since=since, max_builds=effective_max_builds)
                )
            health.append({
                "name": label,
                "kind": "jenkins",
                "ok": True,
                "error": None,
                "latency_ms": int((time.monotonic() - t0) * 1000),
            })
        except Exception as exc:
            logger.error("Jenkins [%s] builds failed: %s", label, exc)
            _push_collect_log("jenkins_builds", f"Jenkins: {label}", f"builds failed: {exc}", "error")
            health.append({
                "name": label,
                "kind": "jenkins",
                "ok": False,
                "error": str(exc),
                "latency_ms": None,
            })

        if inst.get("parse_console", False):
            try:
                from parsers.jenkins_console_parser import JenkinsConsoleParser
                jobs_for_console = inst.get("jobs", []) or []
                # When show_all_jobs is enabled, parse consoles for discovered jobs too (not only explicit jobs).
                if inst.get("show_all_jobs", False):
                    # Discover a limited set to avoid parsing hundreds of jobs by default.
                    # console_jobs_limit: 0 -> unlimited, absent -> default 25
                    raw_limit = inst.get("console_jobs_limit", 25)
                    try:
                        limit = int(raw_limit)
                    except Exception:
                        limit = 25
                    discovered = shared_discovered
                    if discovered:
                        # Only parse consoles for jobs that have a completed status of interest.
                        # This keeps the "parse everything" mode fast and avoids wasting requests on running/unknown.
                        wanted = {"success", "failure", "unstable"}
                        filtered = [n for n in discovered if last_status_by_job.get(n) in wanted]
                        if filtered:
                            discovered = filtered
                        if limit <= 0:
                            discovered_sel = discovered
                        else:
                            discovered_sel = discovered[: max(1, limit)]

                        # Merge explicit jobs (preserve critical flag) + discovered (non-critical by default)
                        explicit_by_name = {
                            (j.get("name") or ""): j for j in (jobs_for_console or []) if (j.get("name") or "")
                        }
                        merged_names = list(explicit_by_name.keys())
                        for n in discovered_sel:
                            if n not in explicit_by_name:
                                merged_names.append(n)
                        jobs_for_console = [
                            {
                                "name": n,
                                "critical": bool(explicit_by_name.get(n, {}).get("critical", False)),
                                "parse_console": True,
                            }
                            for n in merged_names
                        ]
                        logger.info(
                            "Jenkins [%s] console: discovered %d jobs, parsing %d (limit=%s, explicit=%d)",
                            label,
                            len(discovered),
                            len(jobs_for_console),
                            "all" if limit <= 0 else str(limit),
                            len(explicit_by_name),
                        )
                    else:
                        logger.warning(
                            "Jenkins [%s] console: show_all_jobs on but no jobs discovered; skipping console parse",
                            label,
                        )
                n_console_jobs_parsed = len(jobs_for_console) if jobs_for_console else 0
                if jobs_for_console:
                    _progress(
                        "jenkins_console",
                        f"Jenkins: {label}",
                        f"Parsing console ({len(jobs_for_console)} job(s))…",
                    )

                def _append_tests_live_inst(recs: list[TestRecord]) -> None:
                    if not recs:
                        return
                    try:
                        for r in recs:
                            if getattr(r, "source_instance", None) in (None, ""):
                                r.source_instance = inst_key
                    except Exception:
                        pass
                    _append_tests_live(recs)

                console_parser = JenkinsConsoleParser(
                    url=inst["url"],
                    username=inst.get("username", ""),
                    token=inst.get("token", ""),
                    jobs=jobs_for_console,
                    max_builds=int(inst.get("console_builds", 5) or 0),
                    workers=int(inst.get("console_workers", 8) or 8),
                    verify_ssl=bool(inst.get("verify_ssl", True)),
                    retries=int(inst.get("console_retries", 3) or 3),
                    backoff_seconds=float(inst.get("console_backoff_seconds", 0.8) or 0.8),
                    records_cb=_append_tests_live_inst,
                    progress_cb=lambda msg: _progress("jenkins_console", f"Jenkins: {label}", msg),
                    timing_cb=lambda d: _collect_slow.append({
                        "ts": datetime.now(tz=timezone.utc).isoformat(),
                        "level": "info",
                        "instance": label,
                        "kind": d.get("kind"),
                        "job": d.get("job"),
                        "build": d.get("build"),
                        "elapsed_ms": d.get("elapsed_ms"),
                    }),
                )
                # Parser will stream records via records_cb for live UI; still return list for non-stream uses.
                _ = console_parser.fetch_tests()
            except Exception as exc:
                logger.error("Jenkins [%s] console parse failed: %s", label, exc)
                _push_collect_log("jenkins_console", f"Jenkins: {label}", f"console parse failed: {exc}", "error")

        if inst.get("parse_allure", False):
            try:
                from parsers.jenkins_allure_parser import JenkinsAllureParser

                jobs_for_allure = inst.get("jobs", []) or []
                # When show_all_jobs is enabled, parse Allure for discovered jobs too (not only explicit jobs).
                if inst.get("show_all_jobs", False):
                    # allure_jobs_limit: 0 -> unlimited, absent -> default 25
                    raw_limit = inst.get("allure_jobs_limit", 25)
                    try:
                        limit = int(raw_limit)
                    except Exception:
                        limit = 25
                    discovered = shared_discovered
                    if discovered:
                        # Allure is heavy; only parse jobs that are currently failing/unstable.
                        wanted = {"failure", "unstable"}
                        filtered = [n for n in discovered if last_status_by_job.get(n) in wanted]
                        if filtered:
                            discovered = filtered
                        if limit <= 0:
                            discovered_sel = discovered
                        else:
                            discovered_sel = discovered[: max(1, limit)]

                        explicit_by_name = {
                            (j.get("name") or ""): j for j in (jobs_for_allure or []) if (j.get("name") or "")
                        }
                        merged_names = list(explicit_by_name.keys())
                        for n in discovered_sel:
                            if n not in explicit_by_name:
                                merged_names.append(n)
                        jobs_for_allure = [
                            {
                                "name": n,
                                "critical": bool(explicit_by_name.get(n, {}).get("critical", False)),
                                "parse_allure": True,
                            }
                            for n in merged_names
                        ]
                        logger.info(
                            "Jenkins [%s] allure: discovered %d jobs, parsing %d (limit=%s, explicit=%d)",
                            label,
                            len(discovered),
                            len(jobs_for_allure),
                            "all" if limit <= 0 else str(limit),
                            len(explicit_by_name),
                        )
                    else:
                        logger.warning(
                            "Jenkins [%s] allure: show_all_jobs on but no jobs discovered; skipping allure parse",
                            label,
                        )

                n_allure_jobs_parsed = len(jobs_for_allure) if jobs_for_allure else 0
                if jobs_for_allure:
                    _progress(
                        "jenkins_allure",
                        f"Jenkins: {label}",
                        f"Parsing Allure ({len(jobs_for_allure)} job(s))…",
                    )

                def _append_tests_live_inst(recs: list[TestRecord]) -> None:
                    if not recs:
                        return
                    try:
                        for r in recs:
                            if getattr(r, "source_instance", None) in (None, ""):
                                r.source_instance = inst_key
                    except Exception:
                        pass
                    _append_tests_live(recs)

                try:
                    _ab_raw = inst.get("allure_builds")
                    if _ab_raw is None:
                        _ab_raw = inst.get("console_builds", 5)
                    allure_max_builds = int(_ab_raw)
                except Exception:
                    allure_max_builds = 5
                allure_parser = JenkinsAllureParser(
                    url=inst["url"],
                    username=inst.get("username", ""),
                    token=inst.get("token", ""),
                    jobs=jobs_for_allure,
                    max_builds=allure_max_builds,
                    workers=int(inst.get("allure_workers", 6) or 6),
                    verify_ssl=bool(inst.get("verify_ssl", True)),
                    progress_cb=lambda msg: _progress("jenkins_allure", f"Jenkins: {label}", msg),
                    retries=int(inst.get("allure_retries", 3) or 3),
                    backoff_seconds=float(inst.get("allure_backoff_seconds", 0.8) or 0.8),
                    records_cb=_append_tests_live_inst,
                    timing_cb=lambda d: _collect_slow.append({
                        "ts": datetime.now(tz=timezone.utc).isoformat(),
                        "level": "info",
                        "instance": label,
                        "kind": d.get("kind"),
                        "job": d.get("job"),
                        "build": d.get("build"),
                        "elapsed_ms": d.get("elapsed_ms"),
                    }),
                )
                _ = allure_parser.fetch_tests()
            except Exception as exc:
                logger.error("Jenkins [%s] allure parse failed: %s", label, exc)
                _push_collect_log("jenkins_allure", f"Jenkins: {label}", f"allure parse failed: {exc}", "error")

        jobs_index_size = len(shared_discovered) if inst.get("show_all_jobs") else len(inst.get("jobs") or [])
        snapshot.collect_meta[f"jenkins:{label}"] = {
            "jobs_indexed": jobs_index_size,
            "console_jobs_parsed": n_console_jobs_parsed,
            "allure_jobs_parsed": n_allure_jobs_parsed,
        }

    for inst in cfg.get("gitlab_instances", []):
        if not inst.get("enabled", True):
            continue
        label = inst.get("name", inst.get("url", "GitLab"))
        gl_key = _config_instance_label(inst, kind="gitlab")
        t0 = time.monotonic()
        try:
            _progress("gitlab", f"GitLab: {label}", "Fetching pipelines…")
            from clients.gitlab_client import GitLabClient
            client = GitLabClient(
                url=inst.get("url", "https://gitlab.com"),
                token=inst.get("token", ""),
                projects=inst.get("projects", []),
                show_all=inst.get("show_all_projects", False),
                verify_ssl=bool(inst.get("verify_ssl", True)),
                source_instance=gl_key,
            )
            _merge_build_records(
                client.fetch_builds(since=since, max_builds=inst.get("max_pipelines", 10))
            )
            health.append({
                "name": label,
                "kind": "gitlab",
                "ok": True,
                "error": None,
                "latency_ms": int((time.monotonic() - t0) * 1000),
            })
        except Exception as exc:
            logger.error("GitLab [%s] failed: %s", label, exc)
            health.append({
                "name": label,
                "kind": "gitlab",
                "ok": False,
                "error": str(exc),
                "latency_ms": None,
            })

    p_cfg = cfg.get("parsers", {})
    pytest_parser = PytestXMLParser()
    allure_parser = AllureJsonParser()
    for d in p_cfg.get("pytest_xml_dirs", []):
        try:
            snapshot.tests.extend(pytest_parser.parse_directory(d))
        except Exception as exc:
            logger.error("pytest parser failed for %s: %s", d, exc)
    for d in p_cfg.get("allure_json_dirs", []):
        try:
            snapshot.tests.extend(allure_parser.parse_directory(d))
        except Exception as exc:
            logger.error("allure parser failed for %s: %s", d, exc)

    dm_cfg = cfg.get("docker_monitor", {})
    if dm_cfg.get("enabled"):
        t0 = time.monotonic()
        try:
            _progress("docker", "Docker / HTTP", "Running checks…")
            monitor = DockerMonitor(
                containers=dm_cfg.get("containers", []),
                http_checks=dm_cfg.get("http_checks", []),
                timeout=dm_cfg.get("timeout_seconds", 5),
                show_all=dm_cfg.get("show_all_containers", False),
            )
            snapshot.services = monitor.check_all()
            health.append({
                "name": "Docker monitor",
                "kind": "docker",
                "ok": True,
                "error": None,
                "latency_ms": int((time.monotonic() - t0) * 1000),
            })
        except Exception as exc:
            logger.error("Docker monitor failed: %s", exc)
            health.append({
                "name": "Docker monitor",
                "kind": "docker",
                "ok": False,
                "error": str(exc),
                "latency_ms": None,
            })

    _instance_health = health
    save_snapshot(snapshot)
    _progress("done", "Collect finished", None)
    logger.info(
        "Auto-collect done: builds=%d tests=%d services=%d",
        len(snapshot.builds), len(snapshot.tests), len(snapshot.services),
    )


async def _do_collect(cfg: dict, *, force_full: bool = False) -> None:
    return await _collect_loop_mod.do_collect(
        cfg,
        force_full=force_full,
        collect_state=_collect_state,
        collect_logs=_collect_logs,
        collect_slow=_collect_slow,
        push_collect_log=_push_collect_log,
        run_collect_sync=_run_collect_sync,
        sse_broadcast_async=_sse_broadcast_async,
        data_revision=_data_revision,
    )


async def _collect_loop(cfg: dict) -> None:
    return await _collect_loop_mod.collect_loop(
        cfg,
        auto_collect_enabled_getter=lambda: bool(_auto_collect_enabled),
        interval_seconds_getter=lambda: int(_collect_state.get("interval_seconds") or 300),
        do_collect_fn=lambda c: _do_collect(c, force_full=False),
    )


# ── FastAPI lifespan ──────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _collect_task, _main_loop
    _main_loop = asyncio.get_running_loop()
    cfg = _load_yaml_config()
    w_cfg = cfg.get("web", {})

    # Initialize SQLite persistent storage
    if _SQLITE_AVAILABLE:
        data_dir = Path(cfg.get("general", {}).get("data_dir", "data"))
        try:
            init_db(data_dir)
            logger.info("SQLite history DB initialized at %s", data_dir / "monitor.db")
        except Exception as exc:
            logger.warning("SQLite init failed (non-fatal): %s", exc)

    # Background auto-collect is enabled only when UI LIVE mode is enabled (toggled from the client).
    # We still create the task so it can be enabled later without restarting the server.
    interval = int(w_cfg.get("collect_interval_seconds", 300))
    _collect_state["interval_seconds"] = interval
    if w_cfg.get("auto_collect", True):
        logger.info("Auto-collect is configured (interval=%ds) but starts only when LIVE is enabled.", interval)
        _collect_task = asyncio.create_task(_collect_loop(cfg))
    else:
        logger.info("Auto-collect disabled in config (web.auto_collect=false).")
    proxy_paths = sorted(
        {getattr(r, "path", "") for r in app.routes if getattr(r, "path", "") and "proxy" in getattr(r, "path", "")}
    )
    logger.info(
        "Web app build=%s config=%s proxy_routes=%s",
        _APP_BUILD,
        _config_yaml_path(),
        proxy_paths or "none",
    )
    try:
        cp = await asyncio.to_thread(sync_cursor_proxy_from_config, cfg)
        logger.info("Embedded Cursor proxy: %s", cp)
    except Exception as exc:
        logger.warning("Embedded Cursor proxy startup failed: %s", exc)
    yield
    try:
        await asyncio.to_thread(_shutdown_embedded_cursor_proxy)
    except Exception as exc:
        logger.warning("Embedded Cursor proxy shutdown: %s", exc)
    if _collect_task:
        _collect_task.cancel()
        try:
            await _collect_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="CI/CD Monitor", version="1.0.0", lifespan=lifespan)

_static_dir = Path(__file__).resolve().parent / "static"
if _static_dir.is_dir():
    app.mount("/static", StaticFiles(directory=str(_static_dir)), name="static")


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    rid = (request.headers.get("x-request-id") or "").strip() or str(uuid.uuid4())
    request.state.request_id = rid
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    return response


def _rid(request: Request | None) -> str:
    if request is None:
        return "-"
    return getattr(request.state, "request_id", "-")


# ── REST endpoints ────────────────────────────────────────────────────────

@app.get("/api/status", response_class=JSONResponse)
async def api_status():
    """Return the full snapshot as JSON."""
    snap = _load_snapshot()
    if snap is None:
        return JSONResponse(
            {"error": "No data yet. Run ci_monitor.py to collect data."},
            status_code=404,
        )
    cfg = _load_yaml_config()

    data = json.loads(snap.model_dump_json())
    builds = [b for b in (snap.builds or []) if _is_snapshot_build_enabled(b, cfg)]
    data["builds"] = [
        dict(json.loads(b.model_dump_json()), instance=_inst_label_for_build_with_cfg(b, cfg)) for b in builds
    ]
    return data


async def api_builds(
    page: int = 1,
    per_page: int = 20,
    source: str = "",
    instance: str = "",
    status: str = "",
    job: str = "",
    hours: int = 0,
):
    """
    Paginated build records.
    Query params: page, per_page, source (jenkins|gitlab|…), status (success|failure|…),
                  job (substring), hours (0=all, >0 filter by started_at recency)
    Returns: {items, page, per_page, total, has_more}
    """
    page = max(1, int(page or 1))
    per_page = min(max(1, int(per_page or 20)), 200)
    snap = await _load_snapshot_async()
    if snap is None:
        raise HTTPException(404, "No snapshot data found.")

    cfg = _load_yaml_config()

    items = [b for b in snap.builds if _is_snapshot_build_enabled(b, cfg)]
    if source:
        items = [b for b in items if b.source.lower() == source.lower()]
    if instance:
        want_inst = instance.strip().lower()
        if want_inst:
            items = [
                b
                for b in items
                if (_inst_label_for_build_with_cfg(b, cfg) or "").strip().lower() == want_inst
            ]
    if status:
        want = normalize_build_status(status)
        items = [b for b in items if b.status_normalized == want]
    if job:
        items = [b for b in items if job.lower() in b.job_name.lower()]
    if hours > 0:
        cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=hours)
        items = [
            b for b in items
            if b.started_at and b.started_at.replace(tzinfo=timezone.utc if b.started_at.tzinfo is None else b.started_at.tzinfo) >= cutoff
        ]

    # Totals per source||instance for the full filtered list (UI group headers).
    group_counts: dict[str, dict[str, int]] = {}
    for b in items:
        gk = f"{(b.source or '').strip().lower()}||{(_inst_label_for_build_with_cfg(b, cfg) or '').strip().lower()}"
        if gk not in group_counts:
            group_counts[gk] = {"fail": 0, "warn": 0, "ok": 0, "total": 0}
        rec = group_counts[gk]
        rec["total"] += 1
        sn = b.status_normalized
        if sn == "failure":
            rec["fail"] += 1
        elif sn == "unstable":
            rec["warn"] += 1
        elif sn == "success":
            rec["ok"] += 1

    total = len(items)
    start = (page - 1) * per_page
    end = start + per_page
    page_items = items[start:end]

    job_ctx = _job_build_analytics(snap)
    out_items = []
    for b in page_items:
        row = json.loads(b.model_dump_json())
        row["analytics"] = job_ctx.get(b.job_name, {})
        row["instance"] = _inst_label_for_build_with_cfg(b, cfg)
        out_items.append(row)

    return {
        "items": out_items,
        "page": page,
        "per_page": per_page,
        "total": total,
        "has_more": end < total,
        "group_counts": group_counts,
    }


async def api_instances():
    """Return enabled instance labels for filter dropdowns.

    Labels match ``_config_instance_label`` / ``source_instance`` on builds
    (explicit ``name`` in YAML, otherwise URL host), so instance filtering
    stays consistent even when ``name`` is omitted in config.
    """
    cfg = _load_yaml_config()
    out: list[dict[str, str]] = []
    for inst in (cfg.get("jenkins_instances", []) or []):
        if not inst.get("enabled", True):
            continue
        if not str(inst.get("url", "") or "").strip():
            continue
        out.append({"source": "jenkins", "name": _config_instance_label(inst, kind="jenkins")})
    for inst in (cfg.get("gitlab_instances", []) or []):
        if not inst.get("enabled", True):
            continue
        if not str(inst.get("url", "") or "").strip():
            continue
        out.append({"source": "gitlab", "name": _config_instance_label(inst, kind="gitlab")})
    out.sort(key=lambda x: (x.get("source", ""), x.get("name", "")))
    return out


async def api_builds_history(
    page: int = 1,
    per_page: int = 50,
    job: str = "",
    source: str = "",
    status: str = "",
    days: int = 30,
):
    """
    Paginated build history from SQLite (across collects). Same shape idea as /api/builds
    but backed by monitor.db when available.
    """
    if not _SQLITE_AVAILABLE or _db_query_builds_history is None:
        return {
            "items": [],
            "page": page,
            "per_page": per_page,
            "total": 0,
            "has_more": False,
            "source": "none",
            "note": "sqlite_unavailable",
        }
    try:
        data = _db_query_builds_history(
            job=job,
            source=source,
            status=status,
            page=max(1, page),
            per_page=min(max(1, per_page), 200),
            days=min(max(1, days), 365),
        )
    except Exception as exc:
        logger.warning("api_builds_history: %s", exc)
        raise HTTPException(500, str(exc)) from exc
    data["page"] = max(1, page)
    data["per_page"] = min(max(1, per_page), 200)
    data["source"] = "sqlite"
    return data


def _dashboard_summary_payload() -> dict[str, Any]:
    cfg = _load_yaml_config()
    w_cfg = cfg.get("web", {})
    interval = int(w_cfg.get("collect_interval_seconds", 300))
    stale_threshold = interval * 2

    snap = _load_snapshot()
    collected_at: str | None = None
    age_seconds: float | None = None
    stale = False
    counts = {
        "builds": 0,
        "failed_builds": 0,
        "failed_tests": 0,
        "tests_total": 0,
        "services_down": 0,
    }
    if snap:
        counts["builds"] = len(snap.builds)
        counts["failed_builds"] = sum(
            1 for b in snap.builds if b.status_normalized in ("failure", "unstable")
        )
        counts["failed_tests"] = sum(
            1 for t in snap.tests if t.status_normalized in ("failed", "error")
        )
        counts["tests_total"] = len(snap.tests)
        counts["services_down"] = sum(1 for s in snap.services if s.status_normalized == "down")
        ca = snap.collected_at
        if ca.tzinfo is None:
            ca = ca.replace(tzinfo=timezone.utc)
        else:
            ca = ca.astimezone(timezone.utc)
        collected_at = ca.isoformat()
        age_seconds = (datetime.now(tz=timezone.utc) - ca).total_seconds()
        stale = age_seconds > stale_threshold

    partial_errors: list[dict[str, Any]] = []
    if _collect_state.get("last_error"):
        partial_errors.append({"source": "collect", "message": _collect_state["last_error"]})
    for h in _instance_health:
        if not h.get("ok"):
            partial_errors.append({
                "source": h.get("kind"),
                "name": h.get("name"),
                "message": h.get("error"),
            })

    return {
        "data_revision": _data_revision,
        "snapshot": {
            "collected_at": collected_at,
            "age_seconds": round(age_seconds, 1) if age_seconds is not None else None,
            "stale": stale,
            "stale_threshold_seconds": stale_threshold,
        },
        "counts": counts,
        "collect": {
            "is_collecting": _collect_state["is_collecting"],
            "last_collected_at": _collect_state["last_collected_at"],
            "last_error": _collect_state["last_error"],
            "interval_seconds": interval,
        },
        "partial_errors": partial_errors,
        "instance_health": list(_instance_health),
        "parse_coverage": (snap.collect_meta if snap else {}) or {},
    }


@app.get("/api/dashboard/summary", response_class=JSONResponse)
async def api_dashboard_summary():
    """Single payload for dashboard boot: counts, freshness, collect + source health."""
    return _dashboard_summary_payload()


async def api_instances_health():
    """Last collect: Jenkins / GitLab / Docker poll latency and errors."""
    return {
        "last_collected_at": _collect_state.get("last_collected_at"),
        "instances": list(_instance_health),
    }


@app.get("/api/meta", response_class=JSONResponse)
async def api_meta():
    """Dashboard metadata: snapshot freshness, collect state, correlation, job analytics."""
    cfg = _load_yaml_config()
    w_cfg = cfg.get("web", {})
    interval = int(w_cfg.get("collect_interval_seconds", 300))
    stale_threshold = interval * 2

    snap = await _load_snapshot_async()
    collected_at: str | None = None
    age_seconds: float | None = None
    stale = False
    job_analytics: dict = {}
    if snap:
        job_analytics = _job_build_analytics(snap)
        ca = snap.collected_at
        if ca.tzinfo is None:
            ca = ca.replace(tzinfo=timezone.utc)
        else:
            ca = ca.astimezone(timezone.utc)
        collected_at = ca.isoformat()
        age_seconds = (datetime.now(tz=timezone.utc) - ca).total_seconds()
        stale = age_seconds > stale_threshold

    return {
        "data_revision": _data_revision,
        "snapshot": {
            "collected_at": collected_at,
            "age_seconds": round(age_seconds, 1) if age_seconds is not None else None,
            "stale": stale,
            "stale_threshold_seconds": stale_threshold,
        },
        "collect": {
            "is_collecting": _collect_state["is_collecting"],
            "last_collected_at": _collect_state["last_collected_at"],
            "last_error": _collect_state["last_error"],
            "interval_seconds": interval,
        },
        "correlation": _correlation_last_hour(),
        "job_analytics": job_analytics,
        "parse_coverage": (snap.collect_meta if snap else {}) or {},
    }


@app.get("/api/stream/events")
async def sse_events(request: Request):
    """Server-Sent Events: collect_done + heartbeats. Clients fall back to polling if unavailable."""

    return StreamingResponse(
        _sse_hub.events_generator(
            request,
            _sse_queues,
            hello_event={"type": "hello", "revision": _data_revision},
            queue_maxsize=64,
            ping_timeout_seconds=25.0,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _aggregate_top_failing_tests(
    tests: list[Any],
    *,
    top_n: int,
    suite_sub: str = "",
    name_sub: str = "",
    message_max: int = 300,
) -> list[dict[str, Any]]:
    return _tests_analytics.aggregate_top_failing_tests(
        tests,
        top_n=top_n,
        suite_sub=suite_sub,
        name_sub=name_sub,
        message_max=message_max,
    )


def _filter_tests_by_source(items: list[Any], source: str) -> list[Any]:
    return _tests_analytics.filter_tests_by_source(items, source)


def _filter_tests_by_lookback_hours(
    tests: list[Any],
    *,
    hours: int = 0,
    days: int = 0,
) -> list[Any]:
    return _tests_analytics.filter_tests_by_lookback_hours(tests, hours=hours, days=days)


def _tests_breakdown_real_vs_synth(items: list[Any]) -> dict[str, int]:
    return _tests_analytics.tests_breakdown_real_vs_synth(items)

async def api_tests(
    page: int = 1,
    per_page: int = 30,
    status: str = "",
    suite: str = "",
    name: str = "",
    hours: int = 0,
    source: str = "",
):
    """
    Paginated test records (all individual test runs, not aggregated).
    Query params: page, per_page, status (passed|failed|skipped|error), suite, name (substring),
                  hours (0=all, >0 filter by timestamp recency)
    Returns: {items, page, per_page, total, has_more}
    """
    snap = await _load_snapshot_async()
    if snap is None:
        raise HTTPException(404, "No snapshot data found.")

    items = snap.tests
    if status:
        want = normalize_test_status(status)
        items = [t for t in items if t.status_normalized == want]
    if suite:
        items = [t for t in items if suite.lower() in (t.suite or "").lower()]
    if name:
        items = [t for t in items if name.lower() in t.test_name.lower()]
    if hours > 0:
        cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=hours)
        items = [
            t for t in items
            if t.timestamp and t.timestamp.replace(tzinfo=timezone.utc if t.timestamp.tzinfo is None else t.timestamp.tzinfo) >= cutoff
        ]

    # Breakdown should be "honest" and not depend on source/status selection.
    # So we compute it before applying source/status filters.
    breakdown_base = snap.tests
    if suite:
        breakdown_base = [t for t in breakdown_base if suite.lower() in (t.suite or "").lower()]
    if name:
        breakdown_base = [t for t in breakdown_base if name.lower() in t.test_name.lower()]
    if hours > 0:
        cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=hours)
        breakdown_base = [
            t for t in breakdown_base
            if t.timestamp and t.timestamp.replace(tzinfo=timezone.utc if t.timestamp.tzinfo is None else t.timestamp.tzinfo) >= cutoff
        ]
    breakdown = _tests_breakdown_real_vs_synth(breakdown_base)

    # Now apply source filter to items for actual table content.
    items = _filter_tests_by_source(items, source)

    total = len(items)
    start = (page - 1) * per_page
    end = start + per_page
    page_items = items[start:end]

    return {
        "items": [json.loads(t.model_dump_json()) for t in page_items],
        "page": page,
        "per_page": per_page,
        "total": total,
        "has_more": end < total,
        "breakdown": breakdown,
    }


async def api_top_failures(
    n: int = 50,
    page: int = 1,
    per_page: int = 20,
    suite: str = "",
    name: str = "",
    source: str = "",
    hours: int = 0,
    days: int = 0,
):
    """
    Aggregated top-failing tests, paginated.
    Query: hours or days (days wins if both >0) limit by test timestamp within the current snapshot.
    """
    snap = _load_snapshot()
    if snap is None:
        raise HTTPException(404, "No snapshot data found.")

    tests_items = _filter_tests_by_lookback_hours(snap.tests, hours=int(hours or 0), days=int(days or 0))

    src = (source or "").strip().lower()
    # When source=all (empty), keep rows separated by parser source to avoid mixing
    # synthetic "job as test" with real test cases.
    if not src:
        counter: Counter = Counter()
        messages: dict[str, str] = {}
        msg_ts: dict[str, datetime] = {}
        suites: dict[str, str] = {}
        suite_ts: dict[str, datetime] = {}
        sources: dict[str, str] = {}

        def _rec_ts(rec: Any) -> datetime:
            ts = getattr(rec, "timestamp", None)
            if ts is None:
                return datetime.min.replace(tzinfo=timezone.utc)
            if ts.tzinfo is None:
                return ts.replace(tzinfo=timezone.utc)
            return ts.astimezone(timezone.utc)

        def _candidate_message(rec: Any) -> str | None:
            src_l = (rec.source or "").strip().lower()
            fm = (rec.failure_message or "")
            if fm and str(fm).strip().lower() != "null":
                return str(fm).strip()
            if src_l == "jenkins_build":
                st = (rec.status or "").strip().lower()
                return "Job failed/unstable" if st in ("failed", "error") else "Job failed"
            return None

        for t in tests_items:
            if t.status_normalized in ("failed", "error"):
                inst = getattr(t, "source_instance", None) or ""
                key = f"{inst}::{(t.source or 'unknown')}::{t.test_name}"
                counter[key] += 1
                sources[key] = (t.source or "unknown")
                ts = _rec_ts(t)
                if t.suite and str(t.suite).strip():
                    prev = suite_ts.get(key)
                    if prev is None or ts >= prev:
                        suite_ts[key] = ts
                        suites[key] = str(t.suite).strip()

                cand = _candidate_message(t)
                if not cand:
                    continue
                prev_m_ts = msg_ts.get(key)
                if prev_m_ts is None or ts >= prev_m_ts:
                    msg_ts[key] = ts
                    messages[key] = cand[:300]

        no_detail = "(no failure text in report)"
        all_items = [
            {
                "source": sources.get(k),
                "source_instance": (k.split("::", 2)[0] or None),
                "test_name": k.split("::", 2)[2],
                "count": c,
                "suite": suites.get(k),
                "message": (messages.get(k) or no_detail),
            }
            for k, c in counter.most_common(n)
        ]
        if suite:
            all_items = [i for i in all_items if suite.lower() in (i["suite"] or "").lower()]
        if name:
            all_items = [i for i in all_items if name.lower() in (i["test_name"] or "").lower()]
    else:
        tests = _filter_tests_by_source(tests_items, source)
        all_items = _aggregate_top_failing_tests(
            tests,
            top_n=n,
            suite_sub=suite,
            name_sub=name,
            message_max=300,
        )
        # Attach source for UI badges (single-source modes).
        for it in all_items:
            it.setdefault("source", src if src not in ("real", "synthetic") else None)

    total = len(all_items)
    start = (page - 1) * per_page
    end = start + per_page
    return {
        "items": all_items[start:end],
        "page": page,
        "per_page": per_page,
        "total": total,
        "has_more": end < total,
    }


async def api_services(page: int = 1, per_page: int = 50, status: str = ""):
    snap = await _load_snapshot_async()
    if snap is None:
        raise HTTPException(404, "No snapshot data found.")

    items = snap.services
    if status:
        raw = (status or "").strip().lower()
        if raw == "problems":
            items = [s for s in items if s.status_normalized in ("down", "degraded")]
        else:
            want = normalize_service_status(status)
            items = [s for s in items if s.status_normalized == want]

    total = len(items)
    start = (page - 1) * per_page
    end = start + per_page
    return {
        "items": [json.loads(s.model_dump_json()) for s in items[start:end]],
        "page": page,
        "per_page": per_page,
        "total": total,
        "has_more": end < total,
    }


@app.get("/api/trends", response_class=JSONResponse)
async def api_trends(days: int = 14):
    """Return daily summary history for trend charts (short TTL in-memory cache)."""
    cache_key = f"trends:{days}:{_data_revision}"
    cached = _mem_cache_get(cache_key)
    if cached is not None:
        return JSONResponse(
            content=cached,
            headers={
                "ETag": f'W/"tr-{_data_revision}-{days}"',
                "Cache-Control": "private, max-age=15",
            },
        )
    data = _trends_compute(days)
    _mem_cache_set(cache_key, data)
    return JSONResponse(
        content=data,
        headers={
            "ETag": f'W/"tr-{_data_revision}-{days}"',
            "Cache-Control": "private, max-age=15",
        },
    )


@app.get("/api/uptime", response_class=JSONResponse)
async def api_uptime(days: int = 30):
    """Per-service uptime for last N days (cached)."""
    cache_key = f"uptime:{days}:{_data_revision}"
    cached = _mem_cache_get(cache_key)
    if cached is not None:
        return JSONResponse(
            content=cached,
            headers={
                "ETag": f'W/"up-{_data_revision}-{days}"',
                "Cache-Control": "private, max-age=15",
            },
        )
    data = _uptime_compute(days)
    _mem_cache_set(cache_key, data)
    return JSONResponse(
        content=data,
        headers={
            "ETag": f'W/"up-{_data_revision}-{days}"',
            "Cache-Control": "private, max-age=15",
        },
    )


@app.get("/api/db/stats", response_class=JSONResponse)
async def api_db_stats():
    """SQLite database diagnostics."""
    if not _SQLITE_AVAILABLE:
        return {"enabled": False, "reason": "db.py module not loaded"}
    return db_stats()


@app.get("/api/sources", response_class=JSONResponse)
async def api_sources():
    """Return distinct CI sources present in the snapshot (for filter dropdowns)."""
    snap = _load_snapshot()
    if snap is None:
        return []
    cfg = _load_yaml_config()

    enabled_jenkins = any(
        inst.get("enabled", True) and str(inst.get("url", "") or "").strip()
        for inst in (cfg.get("jenkins_instances", []) or [])
    )
    enabled_gitlab = any(
        inst.get("enabled", True) and str(inst.get("url", "") or "").strip()
        for inst in (cfg.get("gitlab_instances", []) or [])
    )

    sources = {b.source for b in snap.builds if _is_snapshot_build_enabled(b, cfg)}
    if "jenkins" in sources and not enabled_jenkins:
        sources.discard("jenkins")
    if "gitlab" in sources and not enabled_gitlab:
        sources.discard("gitlab")
    return sorted(sources)


@app.get("/api/notifications", response_class=JSONResponse)
async def api_notifications(since_id: int = 0, limit: int = 50):
    """Return state-change notifications (OK→FAIL / FAIL→OK).
    since_id=0 returns all; pass the last seen id to get only new ones.
    """
    items = [n for n in _notify_state.notifications if n["id"] > since_id]
    return {"items": items[-limit:], "total": len(items), "max_id": _notify_state.notify_id_seq}


@app.get("/api/events/persisted", response_class=JSONResponse)
async def api_events_persisted(limit: int = 250):
    """State-change timeline persisted across restarts (from data/event_feed.json)."""
    lim = max(1, min(limit, 500))
    return {"items": _event_feed_load(lim)}


@app.get("/api/analytics/sparklines", response_class=JSONResponse)
async def api_analytics_sparklines(jobs: str = "", limit_per_job: int = 12):
    """Per-job duration history from SQLite for dashboard sparklines (batch, max 40 jobs)."""
    if not _SQLITE_AVAILABLE or _db_build_duration is None:
        return {}
    n = max(3, min(limit_per_job, 30))
    names = [j.strip() for j in jobs.split(",") if j.strip()][:40]
    out: dict[str, list[dict]] = {}
    for name in names:
        pts = _db_build_duration(name, n)
        if pts:
            out[name] = pts
    return out


@app.get("/api/analytics/flaky", response_class=JSONResponse)
async def api_analytics_flaky(
    threshold: float = 0.4, min_runs: int = 4, days: int = 30
):
    """Flaky jobs from SQLite history (complements client-side snapshot heuristic)."""
    if not _SQLITE_AVAILABLE or _db_flaky_analysis is None:
        return {"items": [], "source": "none"}
    items = _db_flaky_analysis(threshold, min_runs, days)
    return {"items": items, "source": "sqlite"}


# ── CSV / XLSX Export ─────────────────────────────────────────────────────

def _to_csv_bytes(headers: list[str], rows: list[list]) -> bytes:
    return _exports.to_csv_bytes(headers, rows)


def _to_xlsx_bytes(headers: list[str], rows: list[list], sheet_name: str = "Data") -> bytes:
    return _exports.to_xlsx_bytes(headers, rows, sheet_name)


async def export_builds(
    fmt: str = "csv",
    source: str = "",
    status: str = "",
    job: str = "",
    hours: int = 0,
):
    return await _exports.export_builds(
        load_snapshot=_load_snapshot,
        fmt=fmt,
        source=source,
        status=status,
        job=job,
        hours=hours,
    )


async def export_tests(
    fmt: str = "csv",
    status: str = "",
    suite: str = "",
    name: str = "",
    hours: int = 0,
    source: str = "",
):
    return await _exports.export_tests(
        load_snapshot=_load_snapshot,
        fmt=fmt,
        status=status,
        suite=suite,
        name=name,
        hours=hours,
        source=source,
    )


async def export_failures(
    fmt: str = "csv",
    n: int = 500,
    suite: str = "",
    name: str = "",
    source: str = "",
    hours: int = 0,
    days: int = 0,
):
    return await _exports.export_failures(
        load_snapshot=_load_snapshot,
        fmt=fmt,
        n=n,
        suite=suite,
        name=name,
        source=source,
        hours=hours,
        days=days,
    )


async def collect_status():
    """Return background collection state."""
    return _collect_api.collect_status_payload(
        collect_state=_collect_state,
        auto_collect_enabled=_auto_collect_enabled,
        auto_collect_enabled_at_iso=_auto_collect_enabled_at_iso,
    )


async def set_auto_collect(request: Request):
    """
    Enable/disable the background auto-collect loop (server-wide).
    Body: {"enabled": true|false}
    """
    global _auto_collect_enabled
    rid = _rid(request)
    try:
        body = await request.json()
    except Exception:
        body = {}
    enabled = _collect_api.parse_enabled(body)
    _auto_collect_enabled = enabled
    global _auto_collect_enabled_at_iso
    _auto_collect_enabled_at_iso = datetime.now(tz=timezone.utc).isoformat() if enabled else None
    logger.info("[%s] auto-collect set to %s", rid, "on" if enabled else "off")
    # When enabling, start the first collection immediately so UI has data and ETA.
    if enabled:
        try:
            cfg = _load_yaml_config()
        except Exception:
            cfg = None
        if cfg and not _collect_state.get("is_collecting"):
            asyncio.create_task(_do_collect(cfg, force_full=False))
    return {"ok": True, "enabled": bool(_auto_collect_enabled)}


async def collect_logs(limit: int = 400, offset: int = 0):
    """
    Recent collect progress lines for UI live log view.
    Returns {items:[...], total:int}
    """
    return _collect_rt.collect_logs(limit=limit, offset=offset)


async def collect_slow(limit: int = 10):
    """Top slow (job/build) operations observed during current collect."""
    return _collect_rt.collect_slow(limit=limit)


async def trigger_collect(request: Request):
    """Manually trigger a data collection."""
    rid = _rid(request)
    if _collect_state["is_collecting"]:
        logger.info("[%s] collect rejected: already in progress", rid)
        return {"ok": False, "message": "Collection already in progress."}
    force_full = False
    try:
        body = await request.json()
        force_full = _collect_triggers.parse_force_full(body)
    except Exception:
        force_full = False
    cfg = _load_yaml_config()
    logger.info("[%s] manual collect started", rid)
    asyncio.create_task(_do_collect(cfg, force_full=force_full))
    return _collect_triggers.started_payload()


async def api_get_settings():
    """Return config for the settings UI — secrets are masked; use POST with same shape to save."""
    return _settings_api.get_settings(_load_yaml_config())


async def api_get_settings_public():
    """Minimal non-secret fields (safe for embedding / diagnostics)."""
    return _settings_api.get_settings_public(_public_settings_payload, _load_yaml_config())


async def api_save_settings(request: Request):
    """Persist new settings to config.yaml and restart the collect loop."""
    global _collect_task

    async def _cancel_collect_task() -> None:
        global _collect_task
        if _collect_task and not _collect_task.done():
            _collect_task.cancel()
            try:
                await _collect_task
            except asyncio.CancelledError:
                pass
            _collect_task = None

    def _set_collect_state_after_save(merged: dict) -> None:
        _collect_state["is_collecting"] = False
        _collect_state["last_error"] = None
        w_cfg = merged.get("web", {})
        _collect_state["interval_seconds"] = int(w_cfg.get("collect_interval_seconds", 300))

    def _restart_collect_after_save(merged: dict) -> None:
        global _collect_task
        w_cfg = merged.get("web", {})
        if w_cfg.get("auto_collect", True):
            _collect_task = asyncio.create_task(_collect_loop(merged))
        else:
            asyncio.create_task(_do_collect(merged, force_full=False))

    return await _settings_api.save_settings_and_restart_collect(
        request_json=request.json,
        load_cfg=_load_yaml_config,
        config_yaml_path=_config_yaml_path,
        cancel_collect_task=_cancel_collect_task,
        set_collect_state_after_save=_set_collect_state_after_save,
        restart_collect_after_save=_restart_collect_after_save,
        sync_cursor_proxy=lambda cfg: asyncio.to_thread(sync_cursor_proxy_from_config, cfg),
    )


def _ui_lang_from_config() -> str:
    cfg = _load_yaml_config()
    gen = MonitorGeneralConfig.model_validate(cfg.get("general") or {})
    lang = str(gen.ui_language).strip().lower()[:5]
    return lang if lang in ("ru", "en") else "en"


async def settings_page(request: Request):
    resp = templates.TemplateResponse(
        "settings.html",
        {"request": request, "ui_language": _ui_lang_from_config()},
    )
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "base-uri 'self'; "
        "object-src 'none'; "
        "frame-ancestors 'self'; "
        "img-src 'self' data:; "
        "style-src 'self' 'unsafe-inline'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://esm.sh; "
        "connect-src 'self'; "
        "font-src 'self' data:; "
    )
    return resp


# ── Action endpoints (trigger builds / restart containers) ────────────────


@app.post("/api/action/jenkins/build", response_class=JSONResponse, dependencies=[Depends(require_shared_token)])
async def action_jenkins_build(request: Request):
    """Trigger a Jenkins job build.
    Body: {"job_name": "...", "instance_url": "..."}
    """
    rid = _rid(request)
    body = await request.json()
    job_name = body.get("job_name", "")
    instance_url = body.get("instance_url", "")
    if not job_name:
        raise HTTPException(400, "job_name is required")
    _check_rate_limit(f"jenkins:{job_name}")
    logger.info("[%s] action jenkins build job=%s", rid, job_name)

    try:
        cfg = _load_yaml_config()
        return _ops_actions.trigger_jenkins_build(cfg=cfg, job_name=job_name, instance_url=instance_url)
    except Exception as exc:
        logger.error("Jenkins trigger failed: %s", exc)
        raise HTTPException(500, f"Failed to trigger build: {exc}")


@app.post("/api/action/gitlab/pipeline", response_class=JSONResponse, dependencies=[Depends(require_shared_token)])
async def action_gitlab_pipeline(request: Request):
    """Trigger a GitLab pipeline.
    Body: {"project_id": "...", "ref": "main", "instance_url": "..."}
    """
    rid = _rid(request)
    body = await request.json()
    project_id = body.get("project_id", "")
    ref = body.get("ref", "main")
    instance_url = body.get("instance_url", "")
    if not project_id:
        raise HTTPException(400, "project_id is required")
    _check_rate_limit(f"gitlab:{project_id}:{ref}")
    logger.info("[%s] action gitlab pipeline project=%s ref=%s", rid, project_id, ref)

    try:
        cfg = _load_yaml_config()
        return _ops_actions.trigger_gitlab_pipeline(
            cfg=cfg, project_id=project_id, ref=ref, instance_url=instance_url
        )
    except Exception as exc:
        logger.error("GitLab trigger failed: %s", exc)
        raise HTTPException(500, f"Failed to trigger pipeline: {exc}")


@app.post("/api/action/docker/container", response_class=JSONResponse, dependencies=[Depends(require_shared_token)])
async def action_docker_container(request: Request):
    """Start, stop, or restart a Docker container.
    Body: {"container_name": "...", "action": "start"|"stop"|"restart"}
    """
    rid = _rid(request)
    body = await request.json()
    container_name = body.get("container_name", "")
    action = (body.get("action") or "restart").lower().strip()
    if not container_name:
        raise HTTPException(400, "container_name is required")
    if action not in ("start", "stop", "restart"):
        raise HTTPException(400, "action must be one of: start, stop, restart")
    _check_rate_limit(f"docker:{container_name}:{action}", window=5)
    logger.info("[%s] action docker %s %s", rid, action, container_name)

    try:
        return _ops_actions.docker_container_action(container_name=container_name, action=action)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        logger.error("Docker %s failed: %s", action, exc)
        raise HTTPException(500, f"Failed to {action} container: {exc}") from exc


@app.post("/api/action/docker/restart", response_class=JSONResponse, dependencies=[Depends(require_shared_token)])
async def action_docker_restart(request: Request):
    """Backward-compatible alias: restart only."""
    body = await request.json()
    container_name = body.get("container_name", "")
    if not container_name:
        raise HTTPException(400, "container_name is required")
    try:
        return _ops_actions.docker_container_action(container_name=container_name, action="restart")
    except Exception as exc:
        logger.error("Docker restart failed: %s", exc)
        raise HTTPException(500, f"Failed to restart container: {exc}") from exc


# ── Log viewers (Jenkins / GitLab / Docker) ───────────────────────────────

@app.get("/api/logs/jenkins", response_class=JSONResponse, dependencies=[Depends(require_shared_token)])
async def api_logs_jenkins(
    request: Request, job_name: str, build_number: int, instance_url: str = ""
):
    """Fetch Jenkins console text for a build. Tries all configured instances unless instance_url is set."""
    if not job_name.strip() or build_number < 1:
        raise HTTPException(400, "job_name and build_number are required")
    _check_rate_limit(f"log:jenkins:{job_name}:{build_number}", window=2)
    logger.info("[%s] GET jenkins log %s #%s", _rid(request), job_name, build_number)

    cfg = _load_yaml_config()
    return _logs_api.fetch_jenkins_log(
        cfg=cfg, job_name=job_name, build_number=build_number, instance_url=instance_url
    )


@app.get("/api/logs/gitlab", response_class=JSONResponse, dependencies=[Depends(require_shared_token)])
async def api_logs_gitlab(
    request: Request, project_id: str, pipeline_id: int, instance_url: str = ""
):
    """Fetch concatenated GitLab job traces for a pipeline."""
    if not project_id.strip() or pipeline_id < 1:
        raise HTTPException(400, "project_id and pipeline_id are required")
    _check_rate_limit(f"log:gitlab:{project_id}:{pipeline_id}", window=2)
    logger.info("[%s] GET gitlab log %s pipeline %s", _rid(request), project_id, pipeline_id)

    cfg = _load_yaml_config()
    return _logs_api.fetch_gitlab_log(
        cfg=cfg, project_id=project_id, pipeline_id=pipeline_id, instance_url=instance_url
    )


@app.get("/api/logs/diff", response_class=JSONResponse, dependencies=[Depends(require_shared_token)])
async def api_logs_diff(
    source: str,
    job_name: str,
    build_number: int,
    instance_url: str = "",
):
    """Compare log of the given build against the last successful build of the same job.
    Returns: {ok, current_build, prev_build, diff_lines: [{tag, line}]}
    tag: '+' added, '-' removed, ' ' unchanged, '?' context only shown
    """
    _check_rate_limit(f"diff:{source}:{job_name}:{build_number}", window=5)
    cfg = _load_yaml_config()
    snap = _load_snapshot()
    return _logs_api.diff_logs(
        source=source,
        job_name=job_name,
        build_number=build_number,
        instance_url=instance_url,
        cfg=cfg,
        snapshot=snap,
    )


@app.get("/api/pipeline/stages", response_class=JSONResponse)
async def api_pipeline_stages(project_id: str, pipeline_id: int, instance_url: str = ""):
    """Return GitLab pipeline job stages with status (lazy-loaded on demand)."""
    if not project_id.strip() or pipeline_id < 1:
        raise HTTPException(400, "project_id and pipeline_id are required")
    _check_rate_limit(f"stages:{project_id}:{pipeline_id}", window=2)

    cfg = _load_yaml_config()
    return _logs_api.pipeline_stages(
        cfg=cfg, project_id=project_id, pipeline_id=pipeline_id, instance_url=instance_url
    )


@app.get("/api/logs/docker", response_class=JSONResponse, dependencies=[Depends(require_shared_token)])
async def api_logs_docker(container: str, tail: int = 4000):
    """Recent Docker container logs (stdout+stderr)."""
    container = container.strip()
    if not container:
        raise HTTPException(400, "container is required")
    _check_rate_limit(f"log:docker:{container}", window=2)
    try:
        return _logs_api.docker_logs_tail(container=container, tail=tail)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        logger.error("Docker logs failed: %s", exc)
        raise HTTPException(500, f"Failed to read logs: {exc}") from exc


@app.get("/api/logs/docker/stream", dependencies=[Depends(require_shared_token)])
async def api_logs_docker_stream(container: str):
    """
    Stream Docker logs (like `docker logs -f`). Closes when the client disconnects or the stream ends.
    """
    container = container.strip()
    if not container:
        raise HTTPException(400, "container is required")
    _check_rate_limit(f"log:docker:stream:{container}", window=3)
    return _logs_api.docker_logs_stream_response(container=container)


@app.post("/webhook/build-complete", dependencies=[Depends(require_shared_token)])
async def webhook_build_complete(request: Request):
    """
    Generic webhook endpoint — receives build completion events from Jenkins/GitLab
    and immediately inserts a record + triggers an incremental collect.

    POST JSON: {
      "source": "jenkins",
      "job": "my-job",
      "status": "success",
      "build_number": 42,
      "url": "https://...",
      "critical": false,
      "trigger_collect": true   // optional: trigger a full collect cycle
    }
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON payload")

    logger.info("Webhook received: %s", payload)

    return _webhooks.handle_build_complete(
        payload,
        load_snapshot=_load_snapshot,
        save_snapshot=save_snapshot,
        is_collecting=lambda: bool(_collect_state.get("is_collecting")),
        load_cfg=_load_yaml_config,
        trigger_collect=lambda cfg: asyncio.create_task(_do_collect(cfg, force_full=False)),
    )


# ── AI Chat (OpenAI) ──────────────────────────────────────────────────────


def _ai_default_model(provider: str) -> str:
    return _ai_helpers.ai_default_model(provider)


def _looks_like_upstream_unreachable(err_text: str) -> bool:
    return _ai_helpers.looks_like_upstream_unreachable(err_text)


def _openai_proxy_url(ai_cfg: dict) -> str | None:
    return _ai_helpers.openai_proxy_url(ai_cfg)


async def _http_probe_public_ip(client: httpx.AsyncClient) -> tuple[str | None, str | None]:
    return await _ai_helpers.http_probe_public_ip(client)


async def api_chat(request: Request):
    """Stream an AI-assistant response powered by OpenAI (or compatible API)."""
    cfg = _load_yaml_config()
    ai_cfg = cfg.get("openai", {})
    provider = ai_cfg.get("provider", "openai")
    api_key = ai_cfg.get("api_key", "").strip()
    if not api_key:
        if provider == "cursor":
            # cursor-api-proxy accepts any key unless CURSOR_BRIDGE_API_KEY is set
            api_key = "unused"
        elif provider == "ollama":
            # Local Ollama OpenAI-compatible API usually needs no key
            api_key = "ollama"
        else:
            raise HTTPException(
                400,
                "API key not configured. Go to Settings → AI Assistant and enter your key.",
            )

    body = await request.json()
    user_messages = body.get("messages", [])
    if not user_messages:
        raise HTTPException(400, "messages list is required")

    context_text = body.get("context", "")
    model = (ai_cfg.get("model") or "").strip() or _ai_default_model(provider)

    _PROVIDER_BASES = {
        "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "openrouter": "https://openrouter.ai/api/v1",
        # OpenAI-compatible surface from cursor-api-proxy (Cursor Agent CLI + local server)
        "cursor": "http://127.0.0.1:8765/v1",
        "ollama": "http://127.0.0.1:11434/v1",
    }

    system_prompt = (
        "You are an AI assistant embedded in a CI/CD monitoring dashboard. "
        "You help engineers understand build failures, test results, service statuses, "
        "Docker container issues, and CI/CD logs.\n"
        "Rules:\n"
        "- Be concise and actionable.\n"
        "- When analyzing logs, highlight errors, root causes, and suggest fixes.\n"
        "- Use markdown formatting (bold, code blocks, lists) for readability.\n"
        "- Answer in the same language the user writes in.\n"
        "- When a Docker container is down or misbehaving, mention its name clearly so the dashboard can offer a restart button.\n"
        "- When a CI job needs re-running, mention the job name clearly so the dashboard can offer a re-run button.\n"
        "- If the user asks to collect/refresh data, say 'collect' or 'refresh data'.\n"
    )
    if context_text:
        system_prompt += "\nCurrent dashboard context:\n" + context_text[:12000]

    messages = [{"role": "system", "content": system_prompt}]
    for m in user_messages[-20:]:
        role = m.get("role", "user")
        if role in ("user", "assistant"):
            messages.append({"role": role, "content": m.get("content", "")})

    from openai import AsyncOpenAI

    proxy_url = _openai_proxy_url(ai_cfg)
    base_url = (ai_cfg.get("base_url") or "").strip()
    if not base_url:
        base_url = _PROVIDER_BASES.get(provider, "")
    timeout = httpx.Timeout(120.0, connect=60.0)
    px_cfg = ai_cfg.get("proxy") if isinstance(ai_cfg.get("proxy"), dict) else {}
    if px_cfg.get("enabled") and not proxy_url:
        logger.warning(
            "OpenAI proxy enabled in config but URL is incomplete — check host/port or full url (config=%s)",
            _config_yaml_path(),
        )

    async def generate():
        http_client: httpx.AsyncClient | None = None
        try:
            if provider == "cursor" and not _resolve_cursor_agent_cached(cfg):
                yield f"data: {json.dumps({'error': CURSOR_AGENT_UNAVAILABLE_MSG})}\n\n"
                yield "data: [DONE]\n\n"
                return
            client_kw: dict = {"api_key": api_key}
            if base_url:
                client_kw["base_url"] = base_url
            if proxy_url:
                # trust_env=False: avoid HTTP_PROXY / ALL_PROXY overriding or mixing with explicit proxy
                http_client = httpx.AsyncClient(
                    proxy=proxy_url, timeout=timeout, trust_env=False
                )
                client_kw["http_client"] = http_client
                logger.info(
                    "OpenAI chat using explicit proxy (scheme=%s)",
                    proxy_url.split("://", 1)[0] if "://" in proxy_url else "?",
                )
            client = AsyncOpenAI(**client_kw)
            stream = await client.chat.completions.create(
                model=model,
                messages=messages,
                stream=True,
                max_tokens=3000,
                temperature=0.4,
            )
            yielded_text = False
            async for chunk in stream:
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta and delta.content:
                    yielded_text = True
                    yield f"data: {json.dumps({'t': delta.content})}\n\n"
            if not yielded_text:
                empty_msg = (
                    "Cursor: пустой ответ от прокси (см. data/cursor_proxy.log). Проверьте CURSOR_API_KEY, "
                    "работу Cursor Agent и лог прокси."
                    if provider == "cursor"
                    else "Модель вернула пустой ответ. Попробуйте ещё раз или смените модель."
                )
                yield f"data: {json.dumps({'error': empty_msg})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:
            msg = str(exc)
            if provider == "cursor" and _looks_like_upstream_unreachable(msg):
                msg = (
                    "Cursor: не удалось подключиться к LLM (часто это 127.0.0.1:8765 без запущенного прокси). "
                    "У Cursor нет публичного «прямого» HTTP chat API для токена crsr в сторонних приложениях — "
                    "чат в IDE идёт через инфраструктуру Cursor, а ключ из дашборда — для Cloud Agents / CLI. "
                    "Варианты: (1) установить Cursor Agent CLI, выполнить `npx cursor-api-proxy`, "
                    "в окружении процесса прокси задать CURSOR_API_KEY с вашим crsr_ токеном, base URL оставить "
                    "http://127.0.0.1:8765/v1; (2) переключить провайдера на Gemini или OpenRouter — там один ключ в настройках."
                )
            elif "unsupported_country" in msg or "unsupported_country_region_territory" in msg:
                msg += (
                    " — Geo-block: OpenAI still sees a blocked client region. "
                    "Try switching provider to Gemini or OpenRouter (free, no geo-restrictions) in Settings → AI Assistant."
                )
            yield f"data: {json.dumps({'error': msg})}\n\n"
        finally:
            if http_client is not None:
                await http_client.aclose()

    return StreamingResponse(generate(), media_type="text/event-stream")


async def api_chat_status():
    """Check whether AI chat is configured (without exposing the key)."""
    cfg = _load_yaml_config()
    ai_cfg = cfg.get("openai", {})
    prov = ai_cfg.get("provider", "openai")
    has_key = bool(ai_cfg.get("api_key", "").strip()) or prov in ("cursor", "ollama")
    proxy_ok = _openai_proxy_url(ai_cfg) is not None
    px = ai_cfg.get("proxy") if isinstance(ai_cfg.get("proxy"), dict) else {}
    proxy_on = bool(px.get("enabled")) and proxy_ok
    model = (ai_cfg.get("model") or "").strip() or _ai_default_model(prov)
    cursor_agent_path: str | None = None
    if prov == "cursor":
        cursor_agent_path = _resolve_cursor_agent_cached(cfg)
    return {
        "configured": has_key,
        "provider": prov,
        "model": model,
        "proxy_enabled": proxy_on,
        "proxy_misconfigured": bool(px.get("enabled")) and not proxy_ok,
        "config_path": str(_config_yaml_path()),
        "app_build": _APP_BUILD,
        "cursor_proxy_embedded": _cursor_proxy_running(),
        "cursor_proxy_autostart": _cursor_proxy_autostart_enabled(cfg),
        "cursor_agent_found": cursor_agent_path is not None if prov == "cursor" else None,
        "cursor_agent_path": cursor_agent_path if prov == "cursor" else None,
    }


async def api_chat_proxy_check():
    """Compare public IP with vs without the configured OpenAI proxy (debug VPN routing)."""
    _check_rate_limit("chat:proxy-check", window=10.0)

    cfg = _load_yaml_config()
    ai_cfg = cfg.get("openai", {})
    proxy_url = _openai_proxy_url(ai_cfg)
    timeout = httpx.Timeout(30.0, connect=25.0)

    out: dict = {
        "config_path": str(_config_yaml_path()),
        "proxy_active": bool(proxy_url),
        "proxy_scheme": proxy_url.split("://", 1)[0] if proxy_url and "://" in proxy_url else None,
        "direct": None,
        "via_proxy": None,
    }

    try:
        async with httpx.AsyncClient(timeout=timeout, trust_env=True) as dc:
            dip, derr = await _http_probe_public_ip(dc)
            out["direct"] = {"ok": derr is None and bool(dip), "ip": dip, "error": derr}
    except Exception as exc:
        out["direct"] = {"ok": False, "ip": None, "error": str(exc)}

    if proxy_url:
        try:
            async with httpx.AsyncClient(
                proxy=proxy_url, timeout=timeout, trust_env=False
            ) as pc:
                pip, perr = await _http_probe_public_ip(pc)
                out["via_proxy"] = {"ok": perr is None and bool(pip), "ip": pip, "error": perr}
        except Exception as exc:
            out["via_proxy"] = {"ok": False, "ip": None, "error": str(exc)}
    else:
        px = ai_cfg.get("proxy") if isinstance(ai_cfg.get("proxy"), dict) else {}
        if px.get("enabled"):
            out["via_proxy"] = {
                "ok": False,
                "ip": None,
                "error": "Proxy is enabled but host/port (or full URL) is missing or invalid.",
            }

    return out




for __r in (
    _ops_router,
    _incident_router,
    _collect_router,
    _builds_router,
    _tests_router,
    _services_router,
    _settings_router,
    _chat_router,
):
    app.include_router(__r)

# ── Dashboard HTML ────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    snap = await _load_snapshot_async()
    cfg = _load_yaml_config()
    lang = _ui_lang_from_config()

    ctx: dict = {
        "request": request,
        "snap": snap,
        "ui_language": lang,
    }
    if snap:
        ctx["builds_ok"] = sum(
            1 for b in snap.builds if b.status_normalized == "success"
        )
        ctx["builds_fail"] = sum(
            1 for b in snap.builds if b.status_normalized == "failure"
        )
        ctx["tests_fail"] = sum(
            1 for t in snap.tests if t.status_normalized in ("failed", "error")
        )
        ctx["svc_down"] = sum(1 for s in snap.services if s.status_normalized == "down")
    resp = templates.TemplateResponse("index.html", ctx)
    # Ensure browsers don't keep an old dashboard JS/HTML while server code changes.
    # (Settings page already uses no-cache headers; apply same to dashboard.)
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "base-uri 'self'; "
        "object-src 'none'; "
        "frame-ancestors 'self'; "
        "img-src 'self' data:; "
        "style-src 'self' 'unsafe-inline'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://esm.sh; "
        "connect-src 'self'; "
        "font-src 'self' data:; "
    )
    return resp
