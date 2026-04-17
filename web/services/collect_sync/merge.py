from __future__ import annotations

from datetime import datetime, timezone


def build_key(b: object) -> str:
    try:
        bn = getattr(b, "build_number", None)
        inst_l = getattr(b, "source_instance", None) or ""
        return (
            f"{getattr(b,'source','')}|{inst_l}|{getattr(b,'job_name','')}|{bn}|"
            f"{getattr(b,'url','') or ''}"
        )
    except Exception:
        return str(id(b))


def merge_build_records(snapshot, new_records: list) -> None:
    if not new_records:
        return
    existing = getattr(snapshot, "builds", None) or []
    existing_by_key = {build_key(b): b for b in existing}
    for b in new_records:
        existing_by_key[build_key(b)] = b
    merged = list(existing_by_key.values())
    try:
        merged.sort(
            key=lambda x: getattr(x, "started_at", None)
            or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
    except Exception:
        pass
    snapshot.builds = merged

