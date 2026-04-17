"""Status endpoint payload builder."""

from __future__ import annotations

import json
from typing import Any, Callable

from fastapi.responses import JSONResponse


def api_status(
    *,
    load_snapshot: Callable[[], Any],
    load_yaml_config: Callable[[], dict],
    is_snapshot_build_enabled: Callable[[Any, dict], bool],
    inst_label_for_build_with_cfg: Callable[[Any, dict], str],
) -> JSONResponse | dict:
    """Return full snapshot JSON, with builds filtered and annotated by instance."""
    snap = load_snapshot()
    if snap is None:
        return JSONResponse(
            {"error": "No data yet. Run ci_monitor.py to collect data."},
            status_code=404,
        )
    cfg = load_yaml_config()
    data = json.loads(snap.model_dump_json())
    builds = [b for b in (snap.builds or []) if is_snapshot_build_enabled(b, cfg)]
    data["builds"] = [
        dict(
            json.loads(b.model_dump_json()),
            instance=inst_label_for_build_with_cfg(b, cfg),
        )
        for b in builds
    ]
    return data
