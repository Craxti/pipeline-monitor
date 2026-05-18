"""GitLab collectors used by the sync collection runner."""

from __future__ import annotations

import time

from urllib.parse import quote_plus


def collect_gitlab_builds(
    *,
    cfg: dict,
    since,
    progress,
    merge_build_records,
    health: list,
    config_instance_label,
    logger,
    incremental_collect: bool,
    get_collector_state_int,
    set_collector_state_int,
    sqlite_available: bool,
    check_cancelled,
    incremental_stats: dict | None = None,
) -> None:
    """Collect build records from configured GitLab instances."""
    from web.services.collect_sync.exceptions import CollectCancelled

    for inst in cfg.get("gitlab_instances", []):
        check_cancelled()
        if not inst.get("enabled", True):
            continue
        label = inst.get("name", inst.get("url", "GitLab"))
        gl_key = config_instance_label(inst, kind="gitlab")
        t0 = time.monotonic()
        try:
            progress("gitlab", f"GitLab: {label}", "Fetching pipelines…")
            check_cancelled()
            from clients.gitlab_client import GitLabClient

            client = GitLabClient(
                url=inst.get("url", "https://gitlab.com"),
                token=inst.get("token", ""),
                projects=inst.get("projects", []),
                show_all=inst.get("show_all_projects", False),
                verify_ssl=bool(inst.get("verify_ssl", True)),
                source_instance=gl_key,
            )
            base = str(inst.get("url", "")).rstrip("/")
            try:
                max_pipes = int(inst.get("max_pipelines", 10))
            except Exception:
                max_pipes = 10

            if client.show_all:
                check_cancelled()
                discovered = client.fetch_project_list()
                explicit_ids = {str(p.get("id", "")).lower() for p in client.projects}
                extra = [{"id": path, "critical": False} for path in discovered if path.lower() not in explicit_ids]
                project_list = list(client.projects) + extra
            else:
                project_list = list(client.projects)

            incremental = bool(
                incremental_collect and sqlite_available and get_collector_state_int and set_collector_state_int
            )

            for proj_cfg in project_list:
                check_cancelled()
                if incremental_stats is not None and incremental:
                    incremental_stats["gitlab_checked"] = int(incremental_stats.get("gitlab_checked", 0) or 0) + 1
                proj_id = str(proj_cfg.get("id", ""))
                critical = bool(proj_cfg.get("critical", False))
                resolved_id = client._resolve_project(proj_id)
                if resolved_id is None:
                    resolved_id = quote_plus(proj_id)
                wm_key = f"gitlab|{base}|{proj_id}"

                if incremental:
                    check_cancelled()
                    prev = int(get_collector_state_int(wm_key, 0) or 0)
                    if prev > 0:
                        head = client._get(f"/api/v4/projects/{resolved_id}/pipelines?per_page=1&order_by=id&sort=desc")
                        check_cancelled()
                        if isinstance(head, list) and head:
                            try:
                                top_id = int(head[0].get("id") or 0)
                            except (TypeError, ValueError):
                                top_id = 0
                            if top_id and top_id <= prev:
                                if incremental_stats is not None:
                                    incremental_stats["gitlab_skipped"] = (
                                        int(incremental_stats.get("gitlab_skipped", 0) or 0) + 1
                                    )
                                continue

                recs = client.fetch_pipelines_for_project(
                    proj_id,
                    resolved_id,
                    since=since,
                    per_page=max_pipes,
                    critical=critical,
                    should_cancel=check_cancelled,
                )
                if recs:
                    merge_build_records(recs)
                    check_cancelled()
                    if incremental:
                        mx = 0
                        for r in recs:
                            bn = getattr(r, "build_number", None)
                            if bn is None:
                                continue
                            try:
                                mx = max(mx, int(bn))
                            except (TypeError, ValueError):
                                continue
                        if mx > 0:
                            try:
                                set_collector_state_int(wm_key, mx)
                            except Exception:
                                pass

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
                "GitLab [%s] collection ok (show_all=%s, incremental=%s, latency_ms=%d)",
                label,
                bool(inst.get("show_all_projects", False)),
                incremental,
                int((time.monotonic() - t0) * 1000),
            )
        except CollectCancelled:
            raise
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
