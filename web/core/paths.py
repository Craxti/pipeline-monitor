"""Repository root path helper."""

from __future__ import annotations

from pathlib import Path

# ``web/core/paths.py`` → parent is ``web/core``, grandparent is ``web``,
# great-grandparent is repo root.
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
