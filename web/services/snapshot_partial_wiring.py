"""Wiring helpers for partial snapshot persistence."""

from __future__ import annotations


def save_snapshot_partial(
    snapshot,
    *,
    snapshot_write_lock,
    data_file: str,
    prime_snapshot_cache,
    bump_revision,
    collect_state: dict,
    load_snapshot,
):
    """Delegate partial snapshot save to `web.services.snapshot_store`."""
    from web.services import snapshot_store as _snapshot_store

    return _snapshot_store.save_snapshot_partial(
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
    logger_debug,
):
    """Delegate throttled partial save to `web.services.partial_snapshot`."""
    from web.services import partial_snapshot as _partial_snapshot

    return _partial_snapshot.maybe_save_partial(
        snapshot,
        last_write_ts_ref=last_write_ts_ref,
        min_interval_s=min_interval_s,
        force=force,
        save_snapshot_partial=save_snapshot_partial_fn,
        logger_debug=logger_debug,
    )
