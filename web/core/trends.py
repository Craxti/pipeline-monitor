"""Trends/uptime history stored in SQLite ``meta`` (optional file for tests)."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from models.models import CISnapshot, normalize_service_status

logger = logging.getLogger(__name__)

# Legacy on-disk location (no longer read/written by the app; history lives in ``monitor.db``).
# Kept ONLY as a reference for migration/troubleshooting.
TRENDS_JSON_LEGACY_PATH = Path("data") / "trends.json"
HISTORY_MAX_DAYS = 30

InstLabeler = Callable[[object, dict[str, Any]], Optional[str]]


def _load_history_list(history_path: Path | None) -> list[dict[str, Any]]:
    if history_path is not None:
        try:
            if not history_path.exists():
                return []
            data = json.loads(history_path.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except Exception:
            return []

    try:
        from web.db import ensure_database_initialized, trends_history_load_list

        if not ensure_database_initialized():
            return []
        return trends_history_load_list()
    except Exception:
        return []


def _save_history_list(history: list[dict[str, Any]], history_path: Path | None) -> None:
    if history_path is not None:
        try:
            history_path.parent.mkdir(parents=True, exist_ok=True)
            history_path.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as exc:
            logger.warning("trends save failed: %s", exc)
        return

    try:
        from web.db import ensure_database_initialized, trends_history_save_list

        if not ensure_database_initialized():
            return
        trends_history_save_list(history)
    except Exception as exc:
        logger.warning("trends save failed: %s", exc)


def append_trends(
    snapshot: CISnapshot,
    *,
    history_path: Path | None = None,
    history_max_days: int = HISTORY_MAX_DAYS,
    load_cfg: Optional[Callable[[], dict[str, Any]]] = None,
    inst_label_for_build: Optional[InstLabeler] = None,
) -> None:
    """Append a daily summary bucket (one entry per day)."""
    now = datetime.now(tz=timezone.utc)
    day_key = now.strftime("%Y-%m-%d")

    try:
        history: list[dict[str, Any]] = _load_history_list(history_path)
    except Exception:
        history = []

    # Remove today's existing entry (will be replaced with fresh data)
    history = [e for e in history if e.get("date") != day_key]

    # Build per-job failure map
    job_failures: dict[str, int] = {}
    job_totals: dict[str, int] = {}
    for b in snapshot.builds:
        j = b.job_name
        job_totals[j] = job_totals.get(j, 0) + 1
        if b.status_normalized in ("failure", "unstable"):
            job_failures[j] = job_failures.get(j, 0) + 1

    # Per-test failure counts
    test_failures: dict[str, int] = {}
    for t in snapshot.tests:
        if t.status_normalized in ("failed", "error"):
            test_failures[t.test_name] = test_failures.get(t.test_name, 0) + 1

    # Per-source breakdowns (for UI filters in Trends)
    builds_by_source: dict[str, dict[str, int]] = {}
    builds_by_instance: dict[str, dict[str, int]] = {}

    cfg_for_inst: dict[str, Any] | None = None
    if load_cfg is not None and inst_label_for_build is not None:
        try:
            cfg_for_inst = load_cfg()
        except Exception:
            cfg_for_inst = None

    for b in snapshot.builds:
        src = str(getattr(b, "source", "") or "").strip().lower() or "unknown"
        st = str(getattr(b, "status_normalized", "") or "").strip().lower()
        rec = builds_by_source.setdefault(src, {"total": 0, "failed": 0})
        rec["total"] += 1
        if st in ("failure", "unstable"):
            rec["failed"] += 1

        if cfg_for_inst and inst_label_for_build:
            inst = inst_label_for_build(b, cfg_for_inst)
            if inst:
                k = f"{src}|{inst}"
                ir = builds_by_instance.setdefault(k, {"total": 0, "failed": 0})
                ir["total"] += 1
                if st in ("failure", "unstable"):
                    ir["failed"] += 1

    def _test_source_group(raw: object) -> str:
        s = str(raw or "").strip().lower()
        if not s:
            return "unknown"
        # Most test data comes from Jenkins console/allure parsers in this project.
        if s.startswith("jenkins"):
            return "jenkins"
        if s.startswith("gitlab"):
            return "gitlab"
        return s

    tests_by_source: dict[str, dict[str, int]] = {}
    test_failures_by_source: dict[str, dict[str, int]] = {}
    for t in snapshot.tests:
        src = _test_source_group(getattr(t, "source", None))
        st = str(getattr(t, "status_normalized", "") or "").strip().lower()
        rec = tests_by_source.setdefault(src, {"total": 0, "failed": 0})
        rec["total"] += 1
        if st in ("failed", "error"):
            rec["failed"] += 1
            tf = test_failures_by_source.setdefault(src, {})
            name = str(getattr(t, "test_name", "") or "")
            tf[name] = tf.get(name, 0) + 1

    # Per-service status snapshot (for uptime history)
    service_health = {s.name: s.status for s in snapshot.services}

    services_down_by_kind: dict[str, int] = {"docker": 0, "http": 0, "other": 0}
    for s in snapshot.services:
        if normalize_service_status(s.status) != "down":
            continue
        kind = str(getattr(s, "kind", "") or "").strip().lower()
        if kind == "docker":
            services_down_by_kind["docker"] += 1
        elif kind == "http":
            services_down_by_kind["http"] += 1
        else:
            services_down_by_kind["other"] += 1

    history.append(
        {
            "date": day_key,
            "ts": now.isoformat(),
            "builds_total": len(snapshot.builds),
            "builds_failed": sum(1 for b in snapshot.builds if b.status_normalized in ("failure", "unstable")),
            "tests_total": len(snapshot.tests),
            "tests_failed": sum(1 for t in snapshot.tests if t.status_normalized in ("failed", "error")),
            "services_down": sum(1 for s in snapshot.services if s.status_normalized == "down"),
            "services_down_by_kind": services_down_by_kind,
            "service_health": service_health,
            "builds_by_source": builds_by_source,
            "builds_by_instance": builds_by_instance,
            "tests_by_source": tests_by_source,
            "job_failures": job_failures,
            "job_totals": job_totals,
            "top_test_failures": sorted(test_failures.items(), key=lambda x: -x[1])[:20],
            "top_test_failures_by_source": {
                src: sorted(m.items(), key=lambda x: -x[1])[:20] for src, m in test_failures_by_source.items()
            },
        }
    )

    # Keep only last N days
    cutoff = (now - timedelta(days=int(history_max_days))).strftime("%Y-%m-%d")
    history = [e for e in history if str(e.get("date", "")) >= cutoff]
    history.sort(key=lambda e: str(e.get("date", "")))

    _save_history_list(history, history_path)


def compute_trends(days: int, *, history_path: Path | None = None) -> list[dict[str, Any]]:
    """Return last `days` daily trend buckets."""
    try:
        history = _load_history_list(history_path)
    except Exception as exc:
        logger.error("Failed to load trends: %s", exc)
        return []
    cutoff = (datetime.now(tz=timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    return [e for e in history if str(e.get("date", "")) >= cutoff]
