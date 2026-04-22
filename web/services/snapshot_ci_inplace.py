"""Insert or refresh a build row in the latest CISnapshot after a manual trigger (no full collect)."""

from __future__ import annotations

import logging

from models.models import BuildRecord

logger = logging.getLogger(__name__)


def prepend_build_record(build: BuildRecord) -> bool:
    """
    Put ``build`` at the front of ``snapshot.builds``, replacing any same-key row.

    Key: (source, source_instance, job_name, build_number). Skips if ``build_number`` is None.
    """
    if build.build_number is None:
        logger.debug("prepend_build_record: skip (no build_number) job=%s", build.job_name)
        return False

    from web.core import runtime as rt
    from web.core import snapshot_cache as sc
    from web.db import ensure_database_initialized, set_latest_snapshot_json

    def _key(b: BuildRecord) -> tuple:
        return (
            str(b.source or "").lower(),
            str(b.source_instance or "").strip().lower(),
            str(b.job_name or ""),
            b.build_number,
        )

    nk = _key(build)
    with rt.snapshot_write_lock:
        snap = rt.load_snapshot()
        if snap is None:
            return False
        builds = list(snap.builds or [])
        builds = [b for b in builds if _key(b) != nk]
        builds.insert(0, build)
        new_snap = snap.model_copy(update={"builds": builds})
        if not ensure_database_initialized():
            return False
        try:
            seq = set_latest_snapshot_json(new_snap.model_dump_json(indent=2))
        except Exception as exc:
            logger.warning("prepend_build_record: persist failed: %s", exc)
            return False
        rt.bump_revision()
        sc.prime_snapshot_cache(new_snap, seq)
    logger.info(
        "Snapshot CI patch: prepended %s build job=%s #%s",
        build.source,
        build.job_name,
        build.build_number,
    )
    return True
