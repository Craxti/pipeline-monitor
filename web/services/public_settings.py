from __future__ import annotations

from typing import Any, Callable


def public_settings_payload(
    cfg: dict,
    *,
    sqlite_available: bool,
    db_stats: Callable[[], dict] | None,
) -> dict[str, Any]:
    """Minimal non-secret fields for UI bootstrapping."""
    g = cfg.get("general") or {}
    w = cfg.get("web") or {}
    sqlite_ok = False
    if sqlite_available and db_stats is not None:
        try:
            st = db_stats()
            sqlite_ok = bool(st.get("enabled"))
        except Exception:
            sqlite_ok = False
    return {
        "ui_language": g.get("ui_language", "en"),
        "project_name": g.get("project_name", "CI/CD Monitor"),
        "web": {
            "host": w.get("host", "0.0.0.0"),
            "port": int(w.get("port", 8000)),
            "auto_collect": w.get("auto_collect", True),
            "collect_interval_seconds": int(w.get("collect_interval_seconds", 300)),
            "live_reload": w.get("live_reload", True),
        },
        "sqlite_enabled": sqlite_ok,
    }

