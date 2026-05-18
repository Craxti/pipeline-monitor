"""Load, normalize, and persist application settings (primary store: ``monitor.db`` / ``meta.app_config_json``; legacy ``config.yaml`` optional for migration)."""

from __future__ import annotations

import copy
import os
from pathlib import Path

import yaml

from config_migrations import migrate_telegram_notifications

from web.core import paths as paths_mod

_CONFIG_MEM: dict | None = None


def data_dir_bootstrap() -> Path:
    """
    Resolve the data directory before the full app config is known.

    Order: env ``CICD_MON_DATA_DIR`` → ``general.data_dir`` from a legacy ``config.yaml`` in repo root or
    CWD (migration only) → default ``data`` (relative to CWD).
    """
    envd = (os.environ.get("CICD_MON_DATA_DIR") or "").strip()
    if envd:
        return Path(envd).expanduser().resolve()

    for p in (paths_mod.REPO_ROOT / "config.yaml", Path("config.yaml")):
        if not p.is_file():
            continue
        try:
            with p.open(encoding="utf-8") as fh:
                y = yaml.safe_load(fh) or {}
            dd = (y.get("general") or {}).get("data_dir")
            if isinstance(dd, str) and dd.strip():
                dpath = Path(dd.strip().strip('"').strip("'"))
                if dpath.is_absolute():
                    return dpath.resolve()
                return (p.parent / dpath).resolve()
        except OSError:
            break

    return Path("data").resolve()


def config_yaml_path() -> Path:
    """
    Path to the primary SQLite file where settings live (``meta`` key ``app_config_json``).
    Name kept for backward compatibility in logs and the UI.
    """
    return data_dir_bootstrap() / "monitor.db"


def _read_legacy_config_yaml() -> dict | None:
    """If a ``config.yaml`` file exists, load it (one-time source before DB is populated)."""
    for p in (paths_mod.REPO_ROOT / "config.yaml", Path("config.yaml")):
        if p.is_file():
            try:
                with p.open(encoding="utf-8") as fh:
                    return normalize_config(yaml.safe_load(fh) or {})
            except OSError:
                return None
    return None


def _load_example_defaults() -> dict:
    ex = paths_mod.REPO_ROOT / "config.example.yaml"
    if ex.is_file():
        with ex.open(encoding="utf-8") as fh:
            return normalize_config(yaml.safe_load(fh) or {})
    return {}


def normalize_config(cfg: dict) -> dict:
    """Migrate legacy single jenkins/gitlab keys to multi-instance lists."""
    if "jenkins" in cfg and "jenkins_instances" not in cfg:
        inst = dict(cfg.pop("jenkins"))
        inst.setdefault("name", "Jenkins")
        cfg["jenkins_instances"] = [inst]
    if "gitlab" in cfg and "gitlab_instances" not in cfg:
        inst = dict(cfg.pop("gitlab"))
        inst.setdefault("name", "GitLab")
        cfg["gitlab_instances"] = [inst]
    migrate_telegram_notifications(cfg)
    return cfg


def invalidate_app_config_cache() -> None:
    """Drop in-memory config so the next read reloads (tests / manual DB edits)."""
    global _CONFIG_MEM
    _CONFIG_MEM = None


def load_yaml_config() -> dict:
    """
    Load the full app configuration. Primary store: ``monitor.db`` key ``app_config_json``.

    Legacy: if the DB is empty, migrate from an existing ``config.yaml`` in repo root or CWD, or seed
    from ``config.example.yaml``.
    """
    global _CONFIG_MEM
    if _CONFIG_MEM is not None:
        return copy.deepcopy(_CONFIG_MEM)

    from web import db

    data_dir = data_dir_bootstrap()
    db.init_db(data_dir)

    cfg = db.get_app_config_from_db()
    if isinstance(cfg, dict) and cfg:
        cfg = normalize_config(cfg)
        _CONFIG_MEM = cfg
        return copy.deepcopy(_CONFIG_MEM)

    cfg = _read_legacy_config_yaml()
    if not cfg:
        cfg = _load_example_defaults()
    if cfg:
        _CONFIG_MEM = normalize_config(cfg)
        db.set_app_config_to_db(_CONFIG_MEM)
        return copy.deepcopy(_CONFIG_MEM)

    _CONFIG_MEM = {}
    return {}


def save_app_config(merged: dict) -> None:
    """
    Persist the merged configuration to SQLite and refresh the in-memory copy.

    ``general.data_dir`` controls where ``monitor.db`` is opened; the caller (Settings save) is expected
    to have merged a consistent tree.
    """
    global _CONFIG_MEM
    from web import db

    norm = normalize_config(merged)
    g = norm.get("general", {}) or {}
    dd = g.get("data_dir", "data")
    db.init_db(dd)
    db.set_app_config_to_db(norm)
    _CONFIG_MEM = norm
