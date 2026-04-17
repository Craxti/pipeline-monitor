from __future__ import annotations

import time
from typing import Any, Callable


def maybe_save_partial(
    snapshot: Any,
    *,
    last_write_ts_ref: dict,
    min_interval_s: float,
    force: bool,
    save_snapshot_partial: Callable[[Any], None],
    logger_debug: Callable[[str, object], None],
) -> None:
    now = time.monotonic()
    last = float(last_write_ts_ref.get("ts", 0.0) or 0.0)
    if not force and (now - last) < float(min_interval_s):
        return
    last_write_ts_ref["ts"] = now
    try:
        save_snapshot_partial(snapshot)
    except Exception as exc:
        logger_debug("Partial snapshot save skipped: %s", exc)

