"""GitLab collectors used by the sync collection runner."""

from __future__ import annotations

import time


def collect_gitlab_builds(
    *,
    cfg: dict,
    since,
    progress,
    merge_build_records,
    health: list,
    config_instance_label,
    logger,
) -> None:
    """Collect build records from configured GitLab instances."""
    for inst in cfg.get("gitlab_instances", []):
        if not inst.get("enabled", True):
            continue
        label = inst.get("name", inst.get("url", "GitLab"))
        gl_key = config_instance_label(inst, kind="gitlab")
        t0 = time.monotonic()
        try:
            progress("gitlab", f"GitLab: {label}", "Fetching pipelines…")
            from clients.gitlab_client import GitLabClient

            client = GitLabClient(
                url=inst.get("url", "https://gitlab.com"),
                token=inst.get("token", ""),
                projects=inst.get("projects", []),
                show_all=inst.get("show_all_projects", False),
                verify_ssl=bool(inst.get("verify_ssl", True)),
                source_instance=gl_key,
            )
            merge_build_records(
                client.fetch_builds(
                    since=since,
                    max_builds=inst.get("max_pipelines", 10),
                )
            )
            health.append(
                {
                    "name": label,
                    "kind": "gitlab",
                    "ok": True,
                    "error": None,
                    "latency_ms": int((time.monotonic() - t0) * 1000),
                }
            )
            logger.info(
                "GitLab [%s] collection ok (show_all=%s, latency_ms=%d)",
                label,
                bool(inst.get("show_all_projects", False)),
                int((time.monotonic() - t0) * 1000),
            )
        except Exception as exc:
            logger.error("GitLab [%s] failed: %s", label, exc)
            health.append(
                {
                    "name": label,
                    "kind": "gitlab",
                    "ok": False,
                    "error": str(exc),
                    "latency_ms": None,
                }
            )
