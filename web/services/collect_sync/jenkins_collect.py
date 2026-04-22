"""Jenkins collectors used by the sync collection runner."""

from __future__ import annotations

import time
from datetime import datetime, timezone


def collect_jenkins(
    *,
    cfg: dict,
    since,
    force_full: bool,
    snapshot,
    progress,
    merge_build_records,
    maybe_save_partial,
    push_collect_log,
    collect_slow,
    health: list,
    config_instance_label,
    logger,
    sqlite_available: bool,
    get_collector_state_int,
    set_collector_state_int,
    TestRecord,
    append_synth_tests_from_builds,
) -> None:
    """Collect Jenkins builds and (optionally) console/Allure tests."""
    from clients.jenkins_client import JenkinsClient

    for inst in cfg.get("jenkins_instances", []):
        if not inst.get("enabled", True):
            continue
        label = inst.get("name", inst.get("url", "Jenkins"))
        inst_key = config_instance_label(inst, kind="jenkins")
        shared_discovered: list[str] = []
        n_console_jobs_parsed = 0
        n_allure_jobs_parsed = 0
        t0 = time.monotonic()
        last_status_by_job: dict[str, str] = {}
        try:
            verify_ssl = bool(inst.get("verify_ssl", True))
            progress("jenkins_builds", f"Jenkins: {label}", "Preparing job list…")

            _raw_limit = inst.get("show_all_limit_jobs", 0)
            try:
                _raw_limit = int(_raw_limit)
            except Exception:
                _raw_limit = 50
            show_all_limit_jobs = None if (_raw_limit is not None and int(_raw_limit) <= 0) else int(_raw_limit)

            client = JenkinsClient(
                url=inst["url"],
                username=inst.get("username", ""),
                token=inst.get("token", ""),
                jobs=inst.get("jobs", []),
                timeout=15,
                show_all=inst.get("show_all_jobs", False),
                show_all_limit_jobs=(
                    show_all_limit_jobs
                    if inst.get("show_all_jobs", False) and not inst.get("jobs") and show_all_limit_jobs is not None
                    else None
                ),
                verify_ssl=verify_ssl,
                progress_cb=lambda msg: progress(
                    "jenkins_builds",
                    f"Jenkins: {label}",
                    msg,
                ),
                source_instance=inst_key,
            )
            if inst.get("show_all_jobs", False):
                try:
                    shared_discovered = client.fetch_job_list() or []
                except Exception as exc:
                    logger.warning("Jenkins [%s] fetch_job_list failed: %s", label, exc)
                    shared_discovered = []
                if show_all_limit_jobs is not None and len(shared_discovered) > show_all_limit_jobs:
                    msg = (
                        f"show_all_limit_jobs={show_all_limit_jobs} trims discovered jobs "
                        f"({len(shared_discovered)} total) for Jenkins: {label}"
                    )
                    logger.warning(msg)
                    try:
                        push_collect_log(
                            "jenkins_builds",
                            f"Jenkins: {label}",
                            msg,
                            "warn",
                        )
                    except Exception:
                        pass

            try:
                effective_max_builds = int(inst.get("max_builds", 10))
            except Exception:
                effective_max_builds = 10
            if inst.get("show_all_jobs", False) and not inst.get("jobs"):
                cap = int(inst.get("show_all_max_builds", 20) or 20)
                if cap > 0:
                    effective_max_builds = min(effective_max_builds, cap)

            if inst.get("show_all_jobs", False):
                limit_jobs = (
                    show_all_limit_jobs if (inst.get("show_all_jobs", False) and not inst.get("jobs")) else None
                )
                progress(
                    "jenkins_builds",
                    f"Jenkins: {label}",
                    f"Fetching lastBuild (bulk)… (limit_jobs={limit_jobs or 'all'})",
                )
                bulk_builds = client.fetch_last_builds_bulk(
                    since=since,
                    limit_jobs=limit_jobs,
                    depth=int(inst.get("show_all_depth", 4) or 4),
                )
                merge_build_records(bulk_builds)

                hist_n = int(inst.get("show_all_history_builds", 0) or 0)
                hist_job_cap = int(inst.get("show_all_history_jobs_cap", 45) or 45)
                if hist_n > 0 and bulk_builds:
                    crit_by: dict[str, bool] = {}
                    for j in inst.get("jobs") or []:
                        jn = (j.get("name") or "").strip()
                        if jn:
                            crit_by[jn] = bool(j.get("critical", False))
                    progress(
                        "jenkins_builds",
                        f"Jenkins: {label}",
                        (f"Fetching build history (≤{hist_n} builds/job, " f"up to {hist_job_cap} jobs)…"),
                    )
                    seen_hist: set[str] = set()
                    n_hist = 0
                    for b in bulk_builds:
                        if n_hist >= max(1, hist_job_cap):
                            break
                        jn = getattr(b, "job_name", None) or ""
                        if not jn or jn in seen_hist:
                            continue
                        if getattr(b, "build_number", None) is None:
                            continue
                        seen_hist.add(jn)
                        n_hist += 1
                        short = jn.rsplit("/", 1)[-1]
                        crit = bool(crit_by.get(jn) or crit_by.get(short))
                        try:
                            extra_hist = client.fetch_builds_for_job(
                                jn,
                                since=since,
                                max_builds=hist_n,
                                critical=crit,
                            )
                            if extra_hist:
                                merge_build_records(extra_hist)
                        except Exception as exc:
                            logger.debug("Jenkins history fetch for %s: %s", jn, exc)

                if inst.get("show_all_jobs", False) and (not shared_discovered) and bulk_builds:
                    try:
                        shared_discovered = [b.job_name for b in bulk_builds if getattr(b, "job_name", None)]
                    except Exception:
                        shared_discovered = []

                for b in bulk_builds:
                    try:
                        last_status_by_job[b.job_name] = b.status_normalized
                    except Exception:
                        pass

                if sqlite_available and not force_full:
                    try:
                        base = str(inst.get("url", "")).rstrip("/")
                        for b in bulk_builds:
                            if not b.build_number:
                                continue
                            k = f"jenkins|{base}|{b.job_name}"
                            prev = get_collector_state_int(k, 0)
                            if int(b.build_number) > int(prev):
                                set_collector_state_int(k, int(b.build_number))
                    except Exception:
                        pass

                append_synth_tests_from_builds(
                    snapshot=snapshot,
                    builds=bulk_builds,
                    inst_key=inst_key,
                    TestRecord=TestRecord,
                )
                maybe_save_partial(snapshot, force=True)
            else:
                progress(
                    "jenkins_builds",
                    f"Jenkins: {label}",
                    f"Fetching builds… (max_builds={effective_max_builds})",
                )
                merge_build_records(
                    client.fetch_builds(
                        since=since,
                        max_builds=effective_max_builds,
                    )
                )

            health.append(
                {
                    "name": label,
                    "kind": "jenkins",
                    "ok": True,
                    "error": None,
                    "latency_ms": int((time.monotonic() - t0) * 1000),
                }
            )
            logger.info(
                "Jenkins [%s] build collection ok (show_all=%s, latency_ms=%d)",
                label,
                bool(inst.get("show_all_jobs", False)),
                int((time.monotonic() - t0) * 1000),
            )
        except Exception as exc:
            logger.error("Jenkins [%s] builds failed: %s", label, exc)
            push_collect_log(
                "jenkins_builds",
                f"Jenkins: {label}",
                f"builds failed: {exc}",
                "error",
            )
            health.append(
                {
                    "name": label,
                    "kind": "jenkins",
                    "ok": False,
                    "error": str(exc),
                    "latency_ms": None,
                }
            )

        if inst.get("parse_console", False):
            try:
                from parsers.jenkins_console_parser import JenkinsConsoleParser

                jobs_for_console = inst.get("jobs", []) or []
                if inst.get("show_all_jobs", False):
                    raw_limit = inst.get("console_jobs_limit", 25)
                    try:
                        limit = int(raw_limit)
                    except Exception:
                        limit = 25
                    discovered = shared_discovered
                    if discovered:
                        wanted = {"success", "failure", "unstable"}
                        filtered = [n for n in discovered if last_status_by_job.get(n) in wanted]
                        if filtered:
                            discovered = filtered
                        discovered_sel = discovered if limit <= 0 else discovered[: max(1, limit)]
                        explicit_by_name = {
                            (j.get("name") or ""): j for j in (jobs_for_console or []) if (j.get("name") or "")
                        }
                        merged_names = list(explicit_by_name.keys())
                        for n in discovered_sel:
                            if n not in explicit_by_name:
                                merged_names.append(n)
                        jobs_for_console = [
                            {
                                "name": n,
                                "critical": bool(explicit_by_name.get(n, {}).get("critical", False)),
                                "parse_console": True,
                            }
                            for n in merged_names
                        ]
                        logger.info(
                            ("Jenkins [%s] console: discovered %d jobs, parsing %d " "(limit=%s, explicit=%d)"),
                            label,
                            len(discovered),
                            len(jobs_for_console),
                            "all" if limit <= 0 else str(limit),
                            len(explicit_by_name),
                        )
                    else:
                        logger.warning(
                            "Jenkins [%s] console: show_all_jobs on but no jobs discovered; " "skipping console parse",
                            label,
                        )
                n_console_jobs_parsed = len(jobs_for_console) if jobs_for_console else 0
                if jobs_for_console:
                    progress(
                        "jenkins_console",
                        f"Jenkins: {label}",
                        f"Parsing console ({len(jobs_for_console)} job(s))…",
                    )

                def _append_tests_live_inst(recs: list) -> None:
                    if not recs:
                        return
                    try:
                        for r in recs:
                            if getattr(r, "source_instance", None) in (None, ""):
                                r.source_instance = inst_key
                    except Exception:
                        pass
                    snapshot.tests.extend(recs)
                    maybe_save_partial(snapshot)

                console_parser = JenkinsConsoleParser(
                    url=inst["url"],
                    username=inst.get("username", ""),
                    token=inst.get("token", ""),
                    jobs=jobs_for_console,
                    max_builds=int(inst.get("console_builds", 5) or 0),
                    workers=int(inst.get("console_workers", 8) or 8),
                    verify_ssl=bool(inst.get("verify_ssl", True)),
                    retries=int(inst.get("console_retries", 3) or 3),
                    backoff_seconds=float(inst.get("console_backoff_seconds", 0.8) or 0.8),
                    records_cb=_append_tests_live_inst,
                    progress_cb=lambda msg: progress(
                        "jenkins_console",
                        f"Jenkins: {label}",
                        msg,
                    ),
                    timing_cb=lambda d: collect_slow.append(
                        {
                            "ts": datetime.now(tz=timezone.utc).isoformat(),
                            "level": "info",
                            "instance": label,
                            "kind": d.get("kind"),
                            "job": d.get("job"),
                            "build": d.get("build"),
                            "elapsed_ms": d.get("elapsed_ms"),
                        }
                    ),
                )
                _ = console_parser.fetch_tests()
            except Exception as exc:
                logger.error("Jenkins [%s] console parse failed: %s", label, exc)
                push_collect_log(
                    "jenkins_console",
                    f"Jenkins: {label}",
                    f"console parse failed: {exc}",
                    "error",
                )

        if inst.get("parse_allure", False):
            try:
                from parsers.jenkins_allure_parser import JenkinsAllureParser

                jobs_for_allure = inst.get("jobs", []) or []
                if inst.get("show_all_jobs", False):
                    raw_limit = inst.get("allure_jobs_limit", 25)
                    try:
                        limit = int(raw_limit)
                    except Exception:
                        limit = 25
                    discovered = shared_discovered
                    if discovered:
                        wanted = {"failure", "unstable"}
                        filtered = [n for n in discovered if last_status_by_job.get(n) in wanted]
                        if filtered:
                            discovered = filtered
                        discovered_sel = discovered if limit <= 0 else discovered[: max(1, limit)]
                        explicit_by_name = {
                            (j.get("name") or ""): j for j in (jobs_for_allure or []) if (j.get("name") or "")
                        }
                        merged_names = list(explicit_by_name.keys())
                        for n in discovered_sel:
                            if n not in explicit_by_name:
                                merged_names.append(n)
                        jobs_for_allure = [
                            {
                                "name": n,
                                "critical": bool(explicit_by_name.get(n, {}).get("critical", False)),
                                "parse_allure": True,
                            }
                            for n in merged_names
                        ]
                        logger.info(
                            ("Jenkins [%s] allure: discovered %d jobs, parsing %d " "(limit=%s, explicit=%d)"),
                            label,
                            len(discovered),
                            len(jobs_for_allure),
                            "all" if limit <= 0 else str(limit),
                            len(explicit_by_name),
                        )
                    else:
                        logger.warning(
                            "Jenkins [%s] allure: show_all_jobs on but no jobs discovered; " "skipping allure parse",
                            label,
                        )

                n_allure_jobs_parsed = len(jobs_for_allure) if jobs_for_allure else 0
                if jobs_for_allure:
                    progress(
                        "jenkins_allure",
                        f"Jenkins: {label}",
                        f"Parsing Allure ({len(jobs_for_allure)} job(s))…",
                    )

                def _append_tests_live_inst(recs: list) -> None:
                    if not recs:
                        return
                    try:
                        for r in recs:
                            if getattr(r, "source_instance", None) in (None, ""):
                                r.source_instance = inst_key
                    except Exception:
                        pass
                    snapshot.tests.extend(recs)
                    maybe_save_partial(snapshot)

                try:
                    _ab_raw = inst.get("allure_builds")
                    if _ab_raw is None:
                        _ab_raw = inst.get("console_builds", 5)
                    allure_max_builds = int(_ab_raw)
                except Exception:
                    allure_max_builds = 5
                allure_parser = JenkinsAllureParser(
                    url=inst["url"],
                    username=inst.get("username", ""),
                    token=inst.get("token", ""),
                    jobs=jobs_for_allure,
                    max_builds=allure_max_builds,
                    workers=int(inst.get("allure_workers", 6) or 6),
                    verify_ssl=bool(inst.get("verify_ssl", True)),
                    progress_cb=lambda msg: progress(
                        "jenkins_allure",
                        f"Jenkins: {label}",
                        msg,
                    ),
                    retries=int(inst.get("allure_retries", 3) or 3),
                    backoff_seconds=float(inst.get("allure_backoff_seconds", 0.8) or 0.8),
                    records_cb=_append_tests_live_inst,
                    timing_cb=lambda d: collect_slow.append(
                        {
                            "ts": datetime.now(tz=timezone.utc).isoformat(),
                            "level": "info",
                            "instance": label,
                            "kind": d.get("kind"),
                            "job": d.get("job"),
                            "build": d.get("build"),
                            "elapsed_ms": d.get("elapsed_ms"),
                        }
                    ),
                )
                _ = allure_parser.fetch_tests()
            except Exception as exc:
                logger.error("Jenkins [%s] allure parse failed: %s", label, exc)
                push_collect_log(
                    "jenkins_allure",
                    f"Jenkins: {label}",
                    f"allure parse failed: {exc}",
                    "error",
                )

        jobs_index_size = len(shared_discovered) if inst.get("show_all_jobs") else len(inst.get("jobs") or [])
        snapshot.collect_meta[f"jenkins:{label}"] = {
            "jobs_indexed": jobs_index_size,
            "console_jobs_parsed": n_console_jobs_parsed,
            "allure_jobs_parsed": n_allure_jobs_parsed,
        }
        logger.info(
            "Jenkins [%s] parsing summary: jobs_indexed=%d, console_jobs=%d, allure_jobs=%d",
            label,
            jobs_index_size,
            n_console_jobs_parsed,
            n_allure_jobs_parsed,
        )
