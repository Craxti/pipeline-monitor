"""GitHub Actions collectors used by the sync collection runner."""

from __future__ import annotations

import time
from threading import Lock

from web.services.collect_sync import parallel_util
from web.services.collect_sync.exceptions import CollectCancelled


def collect_github_builds(
    *,
    cfg: dict,
    since,
    progress,
    merge_build_records,
    health: list,
    health_lock: Lock | None = None,
    config_instance_label,
    logger,
    check_cancelled,
) -> None:
    """Collect workflow runs from configured GitHub instances (parallel per instance)."""

    def _append_health(item: dict) -> None:
        if health_lock is not None:
            with health_lock:
                health.append(item)
        else:
            health.append(item)

    def _collect_one_instance(inst: dict) -> None:
        check_cancelled()
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

            _append_health(
                {
                    "name": label,
                    "kind": "github",
                    "ok": True,
                    "error": None,
                    "latency_ms": int((time.monotonic() - t0) * 1000),
                }
            )
            logger.info(
                "GitHub [%s] collection ok (show_all=%s, latency_ms=%d)",
                label,
                bool(inst.get("show_all_repos", False)),
                int((time.monotonic() - t0) * 1000),
            )
        except CollectCancelled:
            raise
        except Exception as exc:
            logger.error("GitHub [%s] failed: %s", label, exc)
            _append_health(
                {
                    "name": label,
                    "kind": "github",
                    "ok": False,
                    "error": str(exc),
                    "latency_ms": None,
                }
            )

    instances = [i for i in (cfg.get("github_instances") or []) if i.get("enabled", True)]
    parallel_util.run_parallel_items(
        instances,
        _collect_one_instance,
        parallel=parallel_util.parallel_instances_enabled(cfg),
        max_workers=parallel_util.instance_worker_cap(cfg, len(instances)),
        thread_prefix="github-inst",
    )
