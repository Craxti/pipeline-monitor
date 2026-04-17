"""Instances list endpoint helper (from config)."""

from __future__ import annotations

from typing import Callable


def api_instances(
    *,
    load_yaml_config: Callable[[], dict],
    config_instance_label: Callable[..., str],
) -> list[dict[str, str]]:
    """Return list of enabled Jenkins/GitLab instances from config."""
    cfg = load_yaml_config()
    out: list[dict[str, str]] = []
    for inst in cfg.get("jenkins_instances", []) or []:
        if not inst.get("enabled", True):
            continue
        if not str(inst.get("url", "") or "").strip():
            continue
        out.append({"source": "jenkins", "name": config_instance_label(inst, kind="jenkins")})
    for inst in cfg.get("gitlab_instances", []) or []:
        if not inst.get("enabled", True):
            continue
        if not str(inst.get("url", "") or "").strip():
            continue
        out.append({"source": "gitlab", "name": config_instance_label(inst, kind="gitlab")})
    out.sort(key=lambda x: (x.get("source", ""), x.get("name", "")))
    return out
