from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from web.services.collect_sync import docker_collect as _docker_collect
from web.services.collect_sync import gitlab_collect as _gitlab_collect
from web.services.collect_sync import jenkins_collect as _jenkins_collect
from web.services.collect_sync import local_parsers as _local_parsers
from web.services.collect_sync import merge as _merge
from web.services.collect_sync import progress as _progress
from web.services.collect_sync import synth_tests as _synth_tests


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
    since = datetime.now(tz=timezone.utc) - timedelta(
        days=cfg.get("general", {}).get("default_lookback_days", 7)
    )
    now = datetime.now(tz=timezone.utc)
    if force_full:
        snapshot = CISnapshot(collected_at=now, collect_meta={}, tests=[])
    else:
        prev = load_snapshot() or CISnapshot()
        snapshot = prev.model_copy(
            update={"tests": [], "collect_meta": {}, "collected_at": now}
        )

    snap_lock = threading.Lock()
    health: list[dict[str, Any]] = []

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
        TestRecord=TestRecord,
        append_synth_tests_from_builds=_synth_tests.append_synthetic_tests_from_builds,
    )

    _gitlab_collect.collect_gitlab_builds(
        cfg=cfg,
        since=since,
        progress=progress,
        merge_build_records=merge_build_records,
        health=health,
        config_instance_label=config_instance_label,
        logger=logger,
    )

    _local_parsers.parse_local_test_dirs(cfg=cfg, snapshot=snapshot, logger=logger)

    _docker_collect.collect_docker_services(
        cfg=cfg, snapshot=snapshot, progress=progress, health=health, logger=logger
    )

    instance_health_setter(health)
    save_snapshot(snapshot)
    progress("done", "Collect finished", None)
    logger.info(
        "Auto-collect done: builds=%d tests=%d services=%d",
        len(snapshot.builds),
        len(snapshot.tests),
        len(snapshot.services),
    )

