"""Persist watched container log-intelligence models to SQLite."""

from __future__ import annotations

import json
import logging
from typing import Any

from web.services.log_intelligence.container_model import ContainerLogModel

logger = logging.getLogger(__name__)


def load_watched_models() -> tuple[set[str], dict[str, ContainerLogModel]]:
    """Return watched keys and restored models from disk."""
    try:
        from web import db

        raw = db.get_log_intel_models_json()
    except Exception:
        logger.debug("log-intel persistence load skipped", exc_info=True)
        return set(), {}
    if not (raw or "").strip():
        return set(), {}
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        logger.debug("log-intel persistence blob invalid JSON")
        return set(), {}
    if not isinstance(payload, dict):
        return set(), {}
    watched = {str(k) for k in (payload.get("watched") or []) if k}
    models: dict[str, ContainerLogModel] = {}
    blob = payload.get("models") or {}
    if not isinstance(blob, dict):
        return watched, models
    for key, row in blob.items():
        if key not in watched or not isinstance(row, dict):
            continue
        try:
            models[str(key)] = ContainerLogModel.from_storage_dict(row)
        except Exception:
            logger.debug("log-intel model restore failed for %s", key, exc_info=True)
    return watched, models


def save_watched_models(*, watched: set[str], models: dict[str, ContainerLogModel]) -> None:
    """Persist watched models; silently no-ops when SQLite is unavailable."""
    payload: dict[str, Any] = {
        "watched": sorted(watched),
        "models": {key: models[key].to_storage_dict() for key in watched if key in models},
    }
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    try:
        from web import db

        db.set_log_intel_models_json(body)
    except Exception:
        logger.debug("log-intel persistence save skipped", exc_info=True)
