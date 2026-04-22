"""In-memory state for background collection progress + logs.

Extracted from ``web.app`` to reduce module size and keep state handling isolated.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from collections import deque
from typing import Any, Deque, Dict


@dataclass
class CollectState:
    """Mutable collect state + rolling logs for UI endpoints."""

    state: Dict[str, Any] = field(
        default_factory=lambda: {
            "is_collecting": False,
            "last_collected_at": None,
            "last_error": None,
            "interval_seconds": 300,
            "started_at": None,
            "phase": None,
            "progress_main": None,
            "progress_sub": None,
            "progress_counts": {},
            "cancel_requested": False,
            "stop_reason": None,
            "phase_timings_ms": {},
            "incremental_stats": {},
        }
    )
    logs: Deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=2500))
    slow: Deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=800))
    auto_collect_enabled: bool = False
    auto_collect_enabled_at_iso: str | None = None

    def push_log(
        self,
        phase: str,
        main: str,
        sub: str | None = None,
        level: str = "info",
    ) -> None:
        """Append a structured log record."""
        try:
            lvl = (level or "info").strip().lower()
            if lvl not in ("info", "warn", "error"):
                lvl = "info"
            instance: str | None = None
            job: str | None = None
            m = (main or "").strip()
            if m.startswith("Jenkins: "):
                instance = m[len("Jenkins: ") :].strip()
            elif m.startswith("GitLab: "):
                instance = m[len("GitLab: ") :].strip()
            s = (sub or "").strip()
            if s.startswith("Console: "):
                rest = s[len("Console: ") :]
                job = (rest.split(" #", 1)[0] if " #" in rest else rest).strip()
            elif s.startswith("Allure: "):
                rest = s[len("Allure: ") :]
                job = (rest.split(" #", 1)[0] if " #" in rest else rest).strip()
            elif s.startswith("Builds: "):
                parts = s.split(" ", 2)
                if len(parts) == 3:
                    job = parts[2].strip()
            self.logs.append(
                {
                    "ts": datetime.now(tz=timezone.utc).isoformat(),
                    "level": lvl,
                    "phase": phase,
                    "main": main,
                    "sub": sub,
                    "instance": instance,
                    "job": job,
                    "counts": dict(self.state.get("progress_counts") or {}),
                }
            )
        except Exception:
            pass

    def collect_logs(self, *, limit: int = 400, offset: int = 0) -> dict[str, Any]:
        """Return recent logs with pagination-ish limit/offset."""
        try:
            lim = max(1, min(2000, int(limit)))
        except Exception:
            lim = 400
        try:
            off = max(0, int(offset))
        except Exception:
            off = 0
        items = list(self.logs)
        total = len(items)
        if off:
            items = items[off:]
        items = items[-lim:]
        return {"items": items, "total": total}

    def collect_slow(self, *, limit: int = 10, offset: int = 0) -> dict[str, Any]:
        """Return slow-step timings (sorted by elapsed) with paging."""
        try:
            lim = max(1, min(100, int(limit)))
        except Exception:
            lim = 10
        items = list(self.slow)
        items.sort(key=lambda x: int(x.get("elapsed_ms") or 0), reverse=True)
        try:
            off = max(0, int(offset))
        except Exception:
            off = 0
        total = len(items)
        page = items[off : off + lim]
        return {"items": page, "total": total, "offset": off, "limit": lim, "has_more": (off + lim) < total}
