"""Patch the latest CISnapshot services after a Docker action (no full collect)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def _norm_host_label(raw: str | None) -> str:
    x = (raw or "").strip()
    return x if x else "local"


def _norm_container_name(n: str) -> str:
    return (n or "").strip().lstrip("/").lower()


def apply_docker_service_to_latest_snapshot(
    *,
    container_name: str,
    docker_host_label: str,
    docker_state: str,
) -> bool:
    """
    Update matching docker ``ServiceStatus`` rows in the current snapshot and persist.

    Returns True if at least one row was updated.
    """
    from web.core import runtime as rt
    from web.core import snapshot_cache as sc
    from web.db import ensure_database_initialized, set_latest_snapshot_json

    host_l = _norm_host_label(docker_host_label)
    name_n = _norm_container_name(container_name)
    state_s = str(docker_state or "").lower()
    st = "up" if state_s == "running" else "down"
    detail = f"host={host_l}; state={docker_state}"
    now = datetime.now(tz=timezone.utc)

    with rt.snapshot_write_lock:
        snap = rt.load_snapshot()
        if snap is None:
            return False
        out: list = []
        hits = 0
        for svc in snap.services:
            if str(getattr(svc, "kind", "") or "").lower() != "docker":
                out.append(svc)
                continue
            if _norm_container_name(str(getattr(svc, "name", "") or "")) != name_n:
                out.append(svc)
                continue
            svc_inst = _norm_host_label(getattr(svc, "source_instance", None))
            if svc_inst != host_l:
                out.append(svc)
                continue
            out.append(
                svc.model_copy(
                    update={
                        "status": st,
                        "detail": detail,
                        "checked_at": now,
                    }
                )
            )
            hits += 1
        if hits == 0:
            logger.debug(
                "Docker snapshot patch: no service row for name=%r host=%r",
                container_name,
                host_l,
            )
            return False
        new_snap = snap.model_copy(update={"services": out})
        if not ensure_database_initialized():
            return False
        try:
            seq = set_latest_snapshot_json(new_snap.model_dump_json(indent=2))
        except Exception as exc:
            logger.warning("Docker snapshot patch: persist failed: %s", exc)
            return False
        rt.bump_revision()
        sc.prime_snapshot_cache(new_snap, seq)
    logger.info(
        "Docker snapshot patch: updated %d row(s) name=%r host=%r -> %s (%s)",
        hits,
        container_name,
        host_l,
        st,
        state_s,
    )
    return True
