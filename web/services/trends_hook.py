"""Wiring hook for appending trend history."""

from __future__ import annotations

from typing import Any, Callable


def append_trends(
    snapshot: Any,
    *,
    append_trends_fn: Callable[..., None],
    history_path,
    history_max_days: int,
    load_cfg: Callable[[], dict],
    inst_label_for_build: Callable[..., str],
) -> None:
    """Call the injected `append_trends_fn` with standardized arguments."""
    return append_trends_fn(
        snapshot,
        history_path=history_path,
        history_max_days=history_max_days,
        load_cfg=load_cfg,
        inst_label_for_build=inst_label_for_build,
    )
