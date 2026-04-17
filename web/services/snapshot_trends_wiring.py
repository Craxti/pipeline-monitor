"""Wiring wrapper for trends append operation."""

from __future__ import annotations


def append_trends(
    snapshot,
    *,
    append_trends_fn,
    history_path: str,
    history_max_days: int,
    load_cfg,
    inst_label_for_build,
):
    """Delegate to injected `append_trends_fn`."""
    return append_trends_fn(
        snapshot,
        history_path=history_path,
        history_max_days=history_max_days,
        load_cfg=load_cfg,
        inst_label_for_build=inst_label_for_build,
    )
