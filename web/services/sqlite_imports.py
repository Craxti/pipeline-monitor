"""Optional SQLite-backed history layer.

The project can run without the SQLite module present. Centralize import fallback
logic here so it doesn't get duplicated across `web.app` and route/service modules.
"""

from __future__ import annotations

from typing import Any, Callable

SQLITE_AVAILABLE: bool

init_db: Callable[..., Any] | None
append_snapshot: Callable[..., Any] | None
db_stats: Callable[..., Any] | None
service_uptime: Callable[..., Any] | None
build_duration_history: Callable[..., Any] | None
flaky_analysis: Callable[..., Any] | None
query_builds_history: Callable[..., Any] | None
get_collector_state_int: Callable[..., Any] | None
set_collector_state_int: Callable[..., Any] | None

try:
    # pylint: disable=unused-import
    # Re-exported names are part of the public optional DB surface.
    from web.db import (  # type: ignore
        init_db,
        append_snapshot,
        db_stats,
        service_uptime,
        build_duration_history,
        flaky_analysis,
        query_builds_history,
        get_collector_state_int,
        set_collector_state_int,
    )

    SQLITE_AVAILABLE = True
except ImportError:
    try:
        # pylint: disable=unused-import
        from db import (  # type: ignore
            init_db,
            append_snapshot,
            db_stats,
            service_uptime,
            build_duration_history,
            flaky_analysis,
            query_builds_history,
            get_collector_state_int,
            set_collector_state_int,
        )

        SQLITE_AVAILABLE = True
    except ImportError:
        SQLITE_AVAILABLE = False
        init_db = None
        append_snapshot = None
        db_stats = None
        service_uptime = None
        build_duration_history = None
        flaky_analysis = None
        query_builds_history = None
        get_collector_state_int = None
        set_collector_state_int = None
