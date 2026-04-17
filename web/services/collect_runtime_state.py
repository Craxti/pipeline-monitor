from __future__ import annotations

from dataclasses import dataclass


@dataclass
class CollectRuntimeState:
    collect_rt: object
    state: dict
    logs: list
    slow: list

    def push_log(self, phase: str, main: str, sub: str | None = None, level: str = "info") -> None:
        return getattr(self.collect_rt, "push_log")(phase, main, sub, level)

    def collect_logs(self, *, limit: int = 400, offset: int = 0):
        return getattr(self.collect_rt, "collect_logs")(limit=limit, offset=offset)

    def collect_slow(self, *, limit: int = 10):
        return getattr(self.collect_rt, "collect_slow")(limit=limit)


def make_collect_runtime_state(CollectStateCls) -> CollectRuntimeState:
    rt = CollectStateCls()
    return CollectRuntimeState(collect_rt=rt, state=rt.state, logs=rt.logs, slow=rt.slow)

