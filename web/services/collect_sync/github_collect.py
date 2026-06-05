"""GitHub Actions collectors used by the sync collection runner."""

from __future__ import annotations

import time

from web.services.collect_sync.exceptions import CollectCancelled


def collect_github_builds(
    *,
    cfg: dict,
    since,
    progress,
    merge_build_records,
    health: list,
    config_instance_label,
    logger,
    check_cancelled,
) -> None:
    """Collect workflow runs from configured GitHub instances."""
    for inst in cfg.get("github_instances", []) or []:
        check_cancelled()
        if not inst.get("enabled", True):
            continue
        label = inst.get("name", inst.get("url", "GitHub"))
        gh_key = config_instance_label(inst, kind="github")
        t0 = time.monotonic()
        try:
            progress("github", f"GitHub: {label}", "Fetching workflow runs…")
            check_cancelled()
            from clients.github_client import GitHubClient

            client = GitHubClient(
                url=inst.get("url", "https://github.com"),
                token=inst.get("token", ""),
                repos=inst.get("repos", []),
                show_all=inst.get("show_all_repos", False),
                verify_ssl=bool(inst.get("verify_ssl", True)),
                source_instance=gh_key,
            )
            try:
                max_runs = int(inst.get("max_runs", 10))
            except Exception:
                max_runs = 10

            if client.show_all:
                check_cancelled()
                discovered = client.fetch_repo_list()
                explicit = {str(r.get("id", "")).lower() for r in client.repos if isinstance(r, dict)}
                repo_list = list(client.repos) + [
                    {"id": path, "critical": False} for path in discovered if path.lower() not in explicit
                ]
            else:
                repo_list = list(client.repos)

            for repo_cfg in repo_list:
                check_cancelled()
                if not isinstance(repo_cfg, dict):
                    continue
                repo_id = str(repo_cfg.get("id", "")).strip()
                if not repo_id:
                    continue
                critical = bool(repo_cfg.get("critical", False))
                recs = client.fetch_runs_for_repo(
                    repo_id,
                    since=since,
                    max_runs=max_runs,
                    critical=critical,
                    should_cancel=check_cancelled,
                )
                if recs:
                    merge_build_records(recs)

            health.append(
                {
                    "name": label,
                    "kind": "github",
                    "ok": True,
                    "error": None,
                    "latency_ms": int((time.monotonic() - t0) * 1000),
                }
            )
            logger.info("GitHub [%s] collection ok (latency_ms=%d)", label, int((time.monotonic() - t0) * 1000))
        except CollectCancelled:
            raise
        except Exception as exc:
            logger.error("GitHub [%s] failed: %s", label, exc)
            health.append(
                {
                    "name": label,
                    "kind": "github",
                    "ok": False,
                    "error": str(exc),
                    "latency_ms": None,
                }
            )
