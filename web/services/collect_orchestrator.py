from __future__ import annotations


def run_collect_sync(
    cfg: dict,
    *,
    force_full: bool,
    collect_sync_run_mod,
    CISnapshot,
    TestRecord,
    load_snapshot,
    save_snapshot,
    maybe_save_partial,
    collect_state: dict,
    push_collect_log,
    collect_slow,
    instance_health_setter,
    config_instance_label,
    sqlite_available: bool,
    get_collector_state_int,
    set_collector_state_int,
    logger,
) -> None:
    return collect_sync_run_mod.run_collect_sync(
        cfg,
        force_full=force_full,
        CISnapshot=CISnapshot,
        TestRecord=TestRecord,
        load_snapshot=load_snapshot,
        save_snapshot=save_snapshot,
        maybe_save_partial=maybe_save_partial,
        collect_state=collect_state,
        push_collect_log=push_collect_log,
        collect_slow=collect_slow,
        instance_health_setter=instance_health_setter,
        config_instance_label=config_instance_label,
        sqlite_available=sqlite_available,
        get_collector_state_int=get_collector_state_int,
        set_collector_state_int=set_collector_state_int,
        logger=logger,
    )

