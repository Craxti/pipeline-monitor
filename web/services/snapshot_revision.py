from __future__ import annotations

"""
Compatibility shim.

Some environments/tests may still import ``web.services.snapshot_revision``.
The main app no longer depends on it, but we keep the module to avoid ImportError
in stale processes.
"""


def make_revision_ref(initial: int = 0) -> dict:
    return {"value": int(initial or 0)}

