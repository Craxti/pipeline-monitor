"""
FastAPI web interface for CI/CD Monitor.

Run with:  uvicorn web.app:app --host 0.0.0.0 --port 8080 --reload
Or via:    python ci_monitor.py web
"""

from __future__ import annotations

from web.services import app_composer as _app_composer
from web.core.settings_secrets import (
    SETTINGS_SECRET_MASK as _SETTINGS_SECRET_MASK,
    mask_settings_for_response as _mask_settings_for_response,
    merge_settings_secrets as _merge_settings_secrets,
)

# Public app object (for uvicorn: `web.app:app`)
app = _app_composer.app

# Backward-compatible re-exports (used by `ci_monitor.py` and contract tests)
save_snapshot = _app_composer.save_snapshot
save_snapshot_partial = _app_composer.save_snapshot_partial
maybe_save_partial = _app_composer.maybe_save_partial
_run_collect_sync = _app_composer.run_collect_sync
_do_collect = _app_composer.do_collect
_collect_loop = _app_composer.collect_loop

templates = _app_composer.templates
init_db = _app_composer.init_db
db_stats = _app_composer.db_stats

CURSOR_AGENT_UNAVAILABLE_MSG = _app_composer.CURSOR_AGENT_UNAVAILABLE_MSG

# Contract-test / backward-compat exports
__all__ = [
    "app",
    "save_snapshot",
    "save_snapshot_partial",
    "maybe_save_partial",
    "_run_collect_sync",
    "_do_collect",
    "_collect_loop",
    "templates",
    "init_db",
    "db_stats",
    "CURSOR_AGENT_UNAVAILABLE_MSG",
    "_SETTINGS_SECRET_MASK",
    "_mask_settings_for_response",
    "_merge_settings_secrets",
]
