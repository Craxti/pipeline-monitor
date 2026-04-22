"""Public non-secret settings exposed to UI."""

from __future__ import annotations

from typing import Any, Callable

from web.services import collect_interval_policy as _cip


def public_settings_payload(
    cfg: dict,
    *,
    sqlite_available: bool,
    db_stats: Callable[[], dict] | None,
) -> dict[str, Any]:
    """Minimal non-secret fields for UI bootstrapping."""
    g = cfg.get("general") or {}
    w = cfg.get("web") or {}
    base_iv = int(w.get("collect_interval_seconds", 300) or 300)
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
            "port": int(w.get("port", 8020)),
            "auto_collect": w.get("auto_collect", True),
            "collect_interval_seconds": base_iv,
            "live_reload": w.get("live_reload", True),
            "live_dashboard_poll_seconds": _cip.clamp_live_dashboard_poll_seconds(
                w.get("live_dashboard_poll_seconds", 20)
            ),
            "live_collect_interval_seconds": _cip.clamp_live_collect_interval_seconds(
                w.get("live_collect_interval_seconds", 90),
                base=base_iv,
            ),
        },
        "sqlite_enabled": sqlite_ok,
    }
