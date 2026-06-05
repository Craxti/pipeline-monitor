"""API endpoints for listing available CI sources."""

from __future__ import annotations

from typing import Any, Callable


def api_sources(
    *,
    load_snapshot: Callable[[], Any],
    load_yaml_config: Callable[[], dict],
    is_snapshot_build_enabled: Callable[[Any, dict], bool],
) -> list[str]:
    """Return a sorted list of enabled sources present in the snapshot."""
    snap = load_snapshot()
    if snap is None:
        return []
    cfg = load_yaml_config()

    enabled_jenkins = any(
        inst.get("enabled", True) and str(inst.get("url", "") or "").strip()
        for inst in (cfg.get("jenkins_instances", []) or [])
    )
    enabled_gitlab = any(
        inst.get("enabled", True) and str(inst.get("url", "") or "").strip()
        for inst in (cfg.get("gitlab_instances", []) or [])
    )
    enabled_github = any(
        inst.get("enabled", True) and str(inst.get("url", "") or "").strip()
        for inst in (cfg.get("github_instances", []) or [])
    )

    sources = {b.source for b in (snap.builds or []) if is_snapshot_build_enabled(b, cfg)}
    if enabled_jenkins:
        sources.add("jenkins")
    if enabled_gitlab:
        sources.add("gitlab")
    if enabled_github:
        sources.add("github")
    if "jenkins" in sources and not enabled_jenkins:
        sources.discard("jenkins")
    if "gitlab" in sources and not enabled_gitlab:
        sources.discard("gitlab")
    if "github" in sources and not enabled_github:
        sources.discard("github")
    return sorted(sources)
