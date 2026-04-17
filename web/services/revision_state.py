from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Callable


@dataclass
class RevisionState:
    revision: int = 0

    def bump(self) -> int:
        self.revision += 1
        return self.revision


def register_snapshot_revision_accessor(*, snapshot_cache_mod, get_revision: Callable[[], int]) -> None:
    snapshot_cache_mod.set_snapshot_revision_accessor(get_revision)

