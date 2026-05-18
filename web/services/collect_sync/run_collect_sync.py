"""Blocking collection runner used by the async wrapper."""

from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from web.services.collect_sync import docker_collect as _docker_collect
from web.services.collect_sync import gitlab_collect as _gitlab_collect
from web.services.collect_sync import jenkins_collect as _jenkins_collect
from web.services.collect_sync import local_parsers as _local_parsers
from web.services.collect_sync import merge as _merge
from web.services.collect_sync import progress as _progress
from web.services.collect_sync import jenkins_merge_unified_tests as _jenkins_merge_unified
from web.services.collect_sync import synth_tests as _synth_tests
from web.services.collect_sync.exceptions import CollectCancelled


def run_collect_sync(
    cfg: dict,
    *,
    force_full: bool,
    CISnapshot,
    TestRecord,
    load_snapshot: Callable[[], Any],
    save_snapshot: Callable[[Any], None],
    maybe_save_partial: Callable[..., None],
    collect_state: dict,
    push_collect_log,
    collect_slow,
    instance_health_setter: Callable[[list[dict[str, Any]]], None],
    config_instance_label,
    sqlite_available: bool,
    get_collector_state_int,
    set_collector_state_int,
    logger,
) -> None:
    """Full collection — runs in a thread-pool executor (blocking)."""
    j_enabled = sum(1 for i in cfg.get("jenkins_instances", []) if i.get("enabled", True))
    g_enabled = sum(1 for i in cfg.get("gitlab_instances", []) if i.get("enabled", True))
    dm_enabled = bool(cfg.get("docker_monitor", {}).get("enabled"))
    incremental_collect = (
        (not force_full) and sqlite_available and bool(cfg.get("general", {}).get("incremental_collect", True))
    )
    logger.info(
        "Collect cycle started (force_full=%s, incremental=%s, lookback_days=%s, jenkins=%d, gitlab=%d, docker=%s)",
        force_full,
        incremental_collect,
        cfg.get("general", {}).get("default_lookback_days", 7),
        j_enabled,
        g_enabled,
        "on" if dm_enabled else "off",
    )
    since = datetime.now(tz=timezone.utc) - timedelta(days=cfg.get("general", {}).get("default_lookback_days", 7))
    now = datetime.now(tz=timezone.utc)
    prev_snapshot = None
    if force_full:
        snapshot = CISnapshot(collected_at=now, collect_meta={}, tests=[])
    else:
        prev_snapshot = load_snapshot() or CISnapshot()
        snapshot = prev_snapshot.model_copy(update={"tests": [], "collect_meta": {}, "collected_at": now})

    snap_lock = threading.Lock()
    health: list[dict[str, Any]] = []
    incremental_stats = {
        "jenkins_checked": 0,
        "jenkins_skipped": 0,
        "gitlab_checked": 0,
        "gitlab_skipped": 0,
    }
    collect_state["incremental_stats"] = dict(incremental_stats)

    def _append_tests_live(recs: list) -> None:
        if not recs:
            return
        with snap_lock:
            snapshot.tests.extend(recs)
        maybe_save_partial(snapshot)

    def progress(phase: str, main: str, sub: str | None = None) -> None:
        return _progress.progress_update(
            collect_state=collect_state,
            snapshot=snapshot,
            phase=phase,
            main=main,
            sub=sub,
            push_collect_log=push_collect_log,
        )

    def _between_phases() -> None:
        if collect_state.get("cancel_requested"):
            raise CollectCancelled("Stopped by user")

    def check_cancelled() -> None:
        if collect_state.get("cancel_requested"):
            raise CollectCancelled("Stopped by user")

    def merge_build_records(new_records: list) -> None:
        return _merge.merge_build_records(snapshot, new_records)

    _jenkins_collect.collect_jenkins(
        cfg=cfg,
        since=since,
        force_full=force_full,
        snapshot=snapshot,
        progress=progress,
        merge_build_records=merge_build_records,
        maybe_save_partial=maybe_save_partial,
        push_collect_log=push_collect_log,
        collect_slow=collect_slow,
        health=health,
        config_instance_label=config_instance_label,
        logger=logger,
        sqlite_available=sqlite_available,
        get_collector_state_int=get_collector_state_int,
        set_collector_state_int=set_collector_state_int,
        incremental_collect=incremental_collect,
        TestRecord=TestRecord,
        append_synth_tests_from_builds=_synth_tests.append_synthetic_tests_from_builds,
        check_cancelled=check_cancelled,
        incremental_stats=incremental_stats,
    )
    logger.info("Jenkins phase completed: builds=%d tests=%d", len(snapshot.builds), len(snapshot.tests))
    # Always merge Jenkins build + Allure + console into ``jenkins_unified`` (not configurable via YAML/DB).
    try:
        _jenkins_merge_unified.merge_jenkins_unified_tests(snapshot, TestRecord=TestRecord, logger=logger)
        logger.info("Jenkins unified merge applied: tests=%d", len(snapshot.tests))
    except Exception as exc:
        logger.warning("Jenkins unified merge skipped: %s", exc)
    _between_phases()

    _gitlab_collect.collect_gitlab_builds(
        cfg=cfg,
        since=since,
        progress=progress,
        merge_build_records=merge_build_records,
        health=health,
        config_instance_label=config_instance_label,
        logger=logger,
        incremental_collect=incremental_collect,
        get_collector_state_int=get_collector_state_int,
        set_collector_state_int=set_collector_state_int,
        sqlite_available=sqlite_available,
        check_cancelled=check_cancelled,
        incremental_stats=incremental_stats,
    )
    logger.info("GitLab phase completed: builds=%d", len(snapshot.builds))
    _between_phases()

    _local_parsers.parse_local_test_dirs(cfg=cfg, snapshot=snapshot, logger=logger, check_cancelled=check_cancelled)
    logger.info("Local parsers phase completed: tests=%d", len(snapshot.tests))
    _between_phases()

    _docker_collect.collect_docker_services(
        cfg=cfg,
        snapshot=snapshot,
        progress=progress,
        health=health,
        logger=logger,
        check_cancelled=check_cancelled,
    )
    logger.info("Docker/HTTP phase completed: services=%d", len(snapshot.services))
    collect_state["incremental_stats"] = dict(incremental_stats)

    # Guard against transient source outages: if this pass produced zero tests
    # while CI sources failed, preserve previously collected tests so the Tests
    # tab does not "blink" to empty on every failed auto-collect cycle.
    try:
        had_prev_tests = len(getattr(prev_snapshot, "tests", None) or []) > 0
        has_current_tests = len(getattr(snapshot, "tests", None) or []) > 0
        source_errors = any(
            (not bool(h.get("ok", True))) and str(h.get("kind", "")).lower() in {"jenkins", "gitlab"}
            for h in (health or [])
            if isinstance(h, dict)
        )
        jenkins_test_collectors_enabled = any(
            bool(inst.get("enabled", True))
            and (bool(inst.get("parse_console", False)) or bool(inst.get("parse_allure", False)))
            for inst in (cfg.get("jenkins_instances", []) or [])
        )
        parser_cfg = cfg.get("parsers", {}) or {}
        local_test_collectors_enabled = bool(parser_cfg.get("pytest_xml_dirs") or parser_cfg.get("allure_json_dirs"))
        tests_expected = bool(jenkins_test_collectors_enabled or local_test_collectors_enabled)
        if (not force_full) and tests_expected and source_errors and (not has_current_tests) and had_prev_tests:
            snapshot.tests = list(getattr(prev_snapshot, "tests", None) or [])
            msg = "preserved previous tests (current collect yielded 0 tests after source errors)"
            logger.warning("Collect safeguard applied: %s", msg)
            try:
                push_collect_log("tests", "Tests snapshot preserved", msg, "warn")
            except Exception:
                pass
    except Exception as exc:
        logger.debug("Tests preserve safeguard skipped: %s", exc)

    instance_health_setter(health)
    save_snapshot(snapshot)
    progress("done", "Collect finished", None)
    logger.info(
        "Auto-collect done: builds=%d tests=%d services=%d",
        len(snapshot.builds),
        len(snapshot.tests),
        len(snapshot.services),
    )
