from __future__ import annotations

from pathlib import Path

import yaml

from config_migrations import migrate_telegram_notifications

from web.core.paths import REPO_ROOT


def config_yaml_path() -> Path:
    """Resolve ``config.yaml``: prefer repo root (next to ``web/``), else CWD (uvicorn odd cwd)."""
    root_cfg = REPO_ROOT / "config.yaml"
    if root_cfg.is_file():
        return root_cfg
    cwd_cfg = Path("config.yaml")
    if cwd_cfg.is_file():
        return cwd_cfg.resolve()
    return root_cfg


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


def load_yaml_config() -> dict:
    p = config_yaml_path()
    if p.is_file():
        with p.open(encoding="utf-8") as fh:
            return normalize_config(yaml.safe_load(fh) or {})
    return {}
