"""Helpers to map builds to config instances and filter enabled CI sources.

Kept separate from ``web.app`` to reduce module size and avoid circular imports.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urljoin, urlparse


def config_instance_label(inst: dict[str, Any], *, kind: str) -> str:
    """Stable label for a jenkins_instances / gitlab_instances entry (merge + UI grouping)."""
    n = str(inst.get("name") or "").strip()
    if n:
        return n[:240]
    u = str(inst.get("url") or "").strip()
    if u:
        try:
            net = urlparse(u).netloc
            return (net or u.rstrip("/"))[:240]
        except Exception:
            return u[:240]
    return "Jenkins" if kind == "jenkins" else "GitLab"


def enabled_ci_bases(cfg: dict[str, Any], kind: str) -> list[str]:
    insts = cfg.get(f"{kind}_instances", []) or []
    out: list[str] = []
    for inst in insts:
        if not inst.get("enabled", True):
            continue
        u = str(inst.get("url", "") or "").strip()
        if u:
            out.append(u.rstrip("/"))
    return out


def build_url_matches_ci_bases(b: Any, bases: list[str]) -> bool:
    """Whether build.url belongs to one of the configured instance roots.

    Jenkins sometimes returns a *path-only* URL (``/job/...``); resolve it against
    each enabled base so those builds are not dropped by the dashboard filter.
    """
    if not bases:
        return False
    bu_raw = str(getattr(b, "url", None) or "").strip()
    if not bu_raw:
        return True
    bu = bu_raw.rstrip("/")
    bl = bu.lower()
    for base in bases:
        br = str(base).rstrip("/")
        if not br:
            continue
        brl = br.lower()
        if bu.startswith(br) or bl.startswith(brl):
            return True
        if bu_raw.startswith("/"):
            try:
                joined = urljoin(br + "/", bu_raw).rstrip("/").lower()
                if joined.startswith(brl):
                    return True
            except Exception:
                pass
    return False


def is_snapshot_build_enabled(b: Any, cfg: dict[str, Any]) -> bool:
    try:
        src = (b.source or "").lower()
    except Exception:
        return True
    if src == "jenkins":
        bases = enabled_ci_bases(cfg, "jenkins")
        return build_url_matches_ci_bases(b, bases)
    if src == "gitlab":
        bases = enabled_ci_bases(cfg, "gitlab")
        return build_url_matches_ci_bases(b, bases)
    return True


def inst_label_for_build_with_cfg(b: Any, cfg: dict[str, Any]) -> str | None:
    """Instance column / filter label: prefer ``source_instance``, else URL → config match."""
    try:
        stored = getattr(b, "source_instance", None)
    except Exception:
        stored = None
    if isinstance(stored, str) and stored.strip():
        return stored.strip()
    try:
        src = (b.source or "").lower()
    except Exception:
        return None
    try:
        bu = (b.url or "").rstrip("/")
    except Exception:
        bu = ""
    if src == "jenkins":
        for inst in (cfg.get("jenkins_instances", []) or []):
            if not inst.get("enabled", True):
                continue
            base = str(inst.get("url", "") or "").rstrip("/")
            if base and bu.startswith(base):
                return config_instance_label(inst, kind="jenkins")
            if base and bu.startswith("/"):
                try:
                    joined = urljoin(base + "/", str(getattr(b, "url", None) or "").strip())
                    if joined.rstrip("/").startswith(base):
                        return config_instance_label(inst, kind="jenkins")
                except Exception:
                    pass
        return None
    if src == "gitlab":
        for inst in (cfg.get("gitlab_instances", []) or []):
            if not inst.get("enabled", True):
                continue
            base = str(inst.get("url", "") or "").rstrip("/")
            if base and bu.startswith(base):
                return config_instance_label(inst, kind="gitlab")
            if base and bu.startswith("/"):
                try:
                    joined = urljoin(base + "/", str(getattr(b, "url", None) or "").strip())
                    if joined.rstrip("/").startswith(base):
                        return config_instance_label(inst, kind="gitlab")
                except Exception:
                    pass
        return None
    return None
