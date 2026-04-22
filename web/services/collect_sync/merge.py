"""Merge helpers for build records."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def build_key(b: object) -> str:
    """Return a stable unique key for a build record-like object (strict fallback)."""
    try:
        bn = getattr(b, "build_number", None)
        inst_l = getattr(b, "source_instance", None) or ""
        src = getattr(b, "source", "") or ""
        # GitLab: pipeline id is unique per instance — do not key on job_name so
        # path vs numeric project id does not create duplicate rows.
        if (src or "").lower() == "gitlab" and bn is not None:
            try:
                return f"gitlab|{inst_l}|{int(bn)}"
            except (TypeError, ValueError):
                pass
        if bn is not None:
            return f"{getattr(b,'source','')}|{inst_l}|{getattr(b,'job_name','')}|{bn}"
        return (
            f"{getattr(b,'source','')}|{inst_l}|{getattr(b,'job_name','')}|none|"
            f"{getattr(b,'url','') or ''}"
        )
    except Exception:
        return str(id(b))


def _started_ts(b: object) -> float:
    t = getattr(b, "started_at", None)
    if t is None:
        return 0.0
    try:
        return float(t.timestamp())
    except Exception:
        return 0.0


def _pick_richer_build(old: object, new: object) -> object:
    """When two records describe the same logical build, keep the more informative row."""
    if _started_ts(new) > _started_ts(old):
        return new
    if _started_ts(new) < _started_ts(old):
        return old
    lj = len(str(getattr(new, "job_name", None) or ""))
    lo = len(str(getattr(old, "job_name", None) or ""))
    if lj != lo:
        return new if lj > lo else old
    nu = len(str(getattr(new, "url", None) or ""))
    ou = len(str(getattr(old, "url", None) or ""))
    if nu != ou:
        return new if nu > ou else old
    return new


def _gitlab_pipeline_identity(b: object) -> tuple[str, str, int] | None:
    if (getattr(b, "source", "") or "").lower() != "gitlab":
        return None
    bn = getattr(b, "build_number", None)
    if bn is None:
        return None
    try:
        pid = int(bn)
    except (TypeError, ValueError):
        return None
    inst = (getattr(b, "source_instance", None) or "").strip()
    return ("gitlab", inst, pid)


def _jenkins_identity(b: object) -> tuple[str, str, int, str] | None:
    if (getattr(b, "source", "") or "").lower() != "jenkins":
        return None
    bn = getattr(b, "build_number", None)
    if bn is None:
        return None
    try:
        n = int(bn)
    except (TypeError, ValueError):
        return None
    inst = (getattr(b, "source_instance", None) or "").strip()
    job = (getattr(b, "job_name", None) or "").strip()
    return ("jenkins", inst, n, job)


def builds_equivalent(a: object, b: object) -> bool:
    """True if two build records are the same pipeline/job+number (relaxed job naming for Jenkins)."""
    ga = _gitlab_pipeline_identity(a)
    gb = _gitlab_pipeline_identity(b)
    if ga is not None and gb is not None:
        return ga == gb
    if ga is not None or gb is not None:
        return False

    ja = _jenkins_identity(a)
    jb = _jenkins_identity(b)
    if ja is not None and jb is not None:
        if ja[1] != jb[1] or ja[2] != jb[2]:
            return False
        from clients.jenkins_client import JenkinsClient

        return JenkinsClient.job_names_equivalent(ja[3], jb[3])
    if ja is not None or jb is not None:
        return False

    return build_key(a) == build_key(b)


def merge_build_records(snapshot, new_records: list) -> None:
    """Merge new build records into snapshot, keeping newest first; dedupe equivalent CI rows."""
    if not new_records:
        return
    existing = list(getattr(snapshot, "builds", None) or [])
    out: list[Any] = list(existing)
    for b in new_records:
        idx = None
        for i, e in enumerate(out):
            if builds_equivalent(e, b):
                idx = i
                break
        if idx is not None:
            out[idx] = _pick_richer_build(out[idx], b)
        else:
            out.append(b)
    try:
        out.sort(
            key=lambda x: getattr(x, "started_at", None) or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
    except Exception:
        pass
    snapshot.builds = out
