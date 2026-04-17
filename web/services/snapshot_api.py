from __future__ import annotations

from typing import Any


def append_trends(
    snapshot,
    *,
    trends_mod,
    history_path: str,
    history_max_days: int,
    load_cfg,
    inst_label_for_build,
):
    from web.services import snapshot_trends_wiring as _snapshot_trends_wiring

    return _snapshot_trends_wiring.append_trends(
        snapshot,
        append_trends_fn=trends_mod.append_trends,
        history_path=history_path,
        history_max_days=history_max_days,
        load_cfg=load_cfg,
        inst_label_for_build=inst_label_for_build,
    )


def save_snapshot(
    snapshot,
    *,
    snapshot_write_lock,
    data_file: str,
    prime_snapshot_cache,
    append_trends_fn,
    detect_state_changes,
    sqlite_available: bool,
    db_append,
    bump_revision,
    logger,
) -> None:
    from web.services import snapshot_save_wiring as _snapshot_save_wiring

    return _snapshot_save_wiring.save_snapshot(
        snapshot,
        snapshot_write_lock=snapshot_write_lock,
        data_file=data_file,
        prime_snapshot_cache=prime_snapshot_cache,
        append_trends=append_trends_fn,
        detect_state_changes=detect_state_changes,
        sqlite_available=sqlite_available,
        db_append=db_append if sqlite_available else None,
        bump_revision=bump_revision,
        logger_warning=logger.warning,
        logger_debug=logger.debug,
    )


def save_snapshot_partial(
    snapshot,
    *,
    snapshot_write_lock,
    data_file: str,
    prime_snapshot_cache,
    bump_revision,
    collect_state: dict,
    load_snapshot,
) -> None:
    from web.services import snapshot_partial_wiring as _snapshot_partial_wiring

    return _snapshot_partial_wiring.save_snapshot_partial(
        snapshot,
        snapshot_write_lock=snapshot_write_lock,
        data_file=data_file,
        prime_snapshot_cache=prime_snapshot_cache,
        bump_revision=bump_revision,
        collect_state=collect_state,
        load_snapshot=load_snapshot,
    )


def maybe_save_partial(
    snapshot,
    *,
    last_write_ts_ref: dict[str, float],
    min_interval_s: float,
    force: bool,
    save_snapshot_partial_fn,
    logger,
) -> None:
    from web.services import snapshot_partial_wiring as _snapshot_partial_wiring

    return _snapshot_partial_wiring.maybe_save_partial(
        snapshot,
        last_write_ts_ref=last_write_ts_ref,
        min_interval_s=min_interval_s,
        force=force,
        save_snapshot_partial_fn=save_snapshot_partial_fn,
        logger_debug=logger.debug,
    )


def public_settings_payload(
    cfg: dict,
    *,
    sqlite_available: bool,
    db_stats,
) -> dict[str, Any]:
    from web.services import public_settings_wiring as _public_settings_wiring

    return _public_settings_wiring.public_settings_payload(
        cfg,
        sqlite_available=sqlite_available,
        db_stats=db_stats if sqlite_available else None,
    )

