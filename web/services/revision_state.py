"""Revision state used to invalidate snapshot caches."""

from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Callable


@dataclass
class RevisionState:
    """Monotonic revision counter."""
    revision: int = 0

    def bump(self) -> int:
        """Increment revision and return new value."""
        self.revision += 1
        return self.revision


def register_snapshot_revision_accessor(
    *,
    snapshot_cache_mod,
    get_revision: Callable[[], int],
) -> None:
    """Register a callable returning current revision in snapshot cache module."""
    snapshot_cache_mod.set_snapshot_revision_accessor(get_revision)
