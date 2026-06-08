"""Persistent registry of user-created service analysis models."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from web.services.log_intelligence.service_keys import make_service_key, parse_service_key

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def list_entries() -> list[dict[str, Any]]:
    from web import db

    return db.list_service_analysis_models()


def get_entry(model_id: int) -> dict[str, Any] | None:
    from web import db

    return db.get_service_analysis_model(model_id)


def get_entry_by_key(service_key: str) -> dict[str, Any] | None:
    from web import db

    return db.get_service_analysis_model_by_key(service_key)


def is_enabled(service_key: str) -> bool:
    entry = get_entry_by_key(service_key)
    return bool(entry and entry.get("enabled"))


def is_registered(service_key: str) -> bool:
    return get_entry_by_key(service_key) is not None


def create_entry(
    *,
    display_name: str,
    service_key: str,
    enabled: bool = True,
) -> dict[str, Any]:
    from web import db

    host, kind, name = parse_service_key(service_key)
    canonical = make_service_key(kind=kind, name=name, source_instance=host)
    if db.get_service_analysis_model_by_key(canonical):
        raise ValueError("Model for this service already exists")
    now = _now_iso()
    row = {
        "display_name": str(display_name or name).strip() or name,
        "service_key": canonical,
        "service_kind": kind,
        "service_name": name,
        "source_instance": host,
        "enabled": bool(enabled),
        "created_at": now,
        "updated_at": now,
    }
    iid = db.insert_service_analysis_model(row)
    row["id"] = iid
    return row


def update_entry(model_id: int, **fields: Any) -> dict[str, Any] | None:
    from web import db

    entry = db.get_service_analysis_model(model_id)
    if not entry:
        return None
    fields = {k: v for k, v in fields.items() if k in ("display_name", "enabled")}
    if not fields:
        return entry
    fields["updated_at"] = _now_iso()
    db.update_service_analysis_model(model_id, **fields)
    return db.get_service_analysis_model(model_id)


def delete_entry(model_id: int) -> dict[str, Any] | None:
    from web import db

    entry = db.get_service_analysis_model(model_id)
    if not entry:
        return None
    db.delete_service_analysis_model(model_id)
    return entry


def migrate_legacy_watched(watched: set[str]) -> None:
    """One-time import of legacy watched keys into the registry table."""
    from web import db

    if db.count_service_analysis_models() > 0:
        return
    for key in sorted(watched):
        try:
            host, kind, name = parse_service_key(key)
        except ValueError:
            logger.debug("skip legacy watched key %s", key)
            continue
        try:
            create_entry(display_name=name, service_key=key, enabled=True)
        except ValueError:
            continue
