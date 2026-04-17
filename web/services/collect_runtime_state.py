"""Adapter around CollectState to expose a stable API."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class CollectRuntimeState:
    """Proxy methods to a CollectState-like object."""

    collect_rt: object
    state: dict
    logs: list
    slow: list

    def push_log(self, phase: str, main: str, sub: str | None = None, level: str = "info") -> None:
        """Append a log record to the underlying collect state."""
        return getattr(self.collect_rt, "push_log")(phase, main, sub, level)

    def collect_logs(self, *, limit: int = 400, offset: int = 0):
        """Return logs from the underlying collect state."""
        return getattr(self.collect_rt, "collect_logs")(limit=limit, offset=offset)

    def collect_slow(self, *, limit: int = 10):
        """Return slow-step timings from the underlying collect state."""
        return getattr(self.collect_rt, "collect_slow")(limit=limit)


def make_collect_runtime_state(collect_state_cls) -> CollectRuntimeState:
    """Create runtime state object from a CollectState class."""
    rt = collect_state_cls()
    return CollectRuntimeState(collect_rt=rt, state=rt.state, logs=rt.logs, slow=rt.slow)
