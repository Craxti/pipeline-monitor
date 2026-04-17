"""Compatibility shim for revision state.

Some environments/tests may still import `web.services.snapshot_revision`.
The main app no longer depends on it, but we keep the module to avoid ImportError
in stale processes.
"""

from __future__ import annotations


def make_revision_ref(initial: int = 0) -> dict:
    """Create a mutable revision reference dict."""
    return {"value": int(initial or 0)}
