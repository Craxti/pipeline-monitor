"""Action endpoints logic (trigger builds / docker actions) extracted from ``web.app``."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException

logger = logging.getLogger(__name__)


def _jenkins_job_critical(inst: dict, job_name: str) -> bool:
    want = (job_name or "").strip()
    if not want:
        return False
    for j in inst.get("jobs") or []:
        if isinstance(j, dict) and str(j.get("name", "")).strip() == want:
            return bool(j.get("critical"))
    return False


def _gitlab_project_critical(inst: dict, project_id: str) -> bool:
    want = (project_id or "").strip()
    if not want:
        return False
    want_l = want.lower()
    for p in inst.get("projects") or []:
        if not isinstance(p, dict):
            continue
        pid = str(p.get("id", "")).strip()
        if not pid:
            continue
        if pid == want or pid.lower() == want_l:
            return bool(p.get("critical"))
    return False


def find_jenkins_instance(cfg: dict, url_hint: str) -> dict | None:
    for inst in cfg.get("jenkins_instances", []):
        if inst.get("url", "").rstrip("/") == (url_hint or "").rstrip("/"):
            return inst
    insts = cfg.get("jenkins_instances", [])
    return insts[0] if insts else None


def find_gitlab_instance(cfg: dict, url_hint: str) -> dict | None:
    for inst in cfg.get("gitlab_instances", []):
        if inst.get("url", "").rstrip("/") == (url_hint or "").rstrip("/"):
            return inst
    insts = cfg.get("gitlab_instances", [])
    return insts[0] if insts else None


def trigger_jenkins_build(*, cfg: dict, job_name: str, instance_url: str) -> Any:
    inst = find_jenkins_instance(cfg, instance_url)
    if not inst:
        raise HTTPException(404, "No Jenkins instance found in config")
    from clients.jenkins_client import JenkinsClient

    client = JenkinsClient(
        url=inst["url"],
        username=inst.get("username", ""),
        token=inst.get("token", ""),
        verify_ssl=bool(inst.get("verify_ssl", True)),
    )
    logger.info(
        "Trigger Jenkins build: job=%s instance=%s url=%s",
        job_name,
        inst.get("name", "Jenkins"),
        inst.get("url", ""),
    )
    result = client.trigger_build(job_name)
    logger.info("Jenkins build trigger response: job=%s result=%s", job_name, result)
    try:
        from datetime import datetime, timezone

        from models.models import BuildRecord, BuildStatus
        from web.services.build_filters import config_instance_label
        from web.services.snapshot_ci_inplace import prepend_build_record

        bn = result.get("build_number")
        if bn is not None:
            try:
                bn_int = int(bn)
            except (TypeError, ValueError):
                bn_int = None
            if bn_int is not None:
                inst_key = config_instance_label(inst, kind="jenkins")
                rec = BuildRecord(
                    source="jenkins",
                    source_instance=inst_key,
                    job_name=job_name,
                    build_number=bn_int,
                    status=BuildStatus.RUNNING,
                    started_at=datetime.now(tz=timezone.utc),
                    duration_seconds=None,
                    url=result.get("url"),
                    critical=_jenkins_job_critical(inst, job_name),
                )
                prepend_build_record(rec)
    except Exception as exc:
        logger.warning("Snapshot patch after Jenkins trigger (non-fatal): %s", exc)
    return result


def trigger_gitlab_pipeline(*, cfg: dict, project_id: str, ref: str, instance_url: str) -> Any:
    inst = find_gitlab_instance(cfg, instance_url)
    if not inst:
        raise HTTPException(404, "No GitLab instance found in config")
    from clients.gitlab_client import GitLabClient

    client = GitLabClient(
        url=inst.get("url", "https://gitlab.com"),
        token=inst.get("token", ""),
        verify_ssl=bool(inst.get("verify_ssl", True)),
    )
    result = client.trigger_pipeline(project_id, ref=ref)
    logger.info("GitLab pipeline trigger response: project=%s ref=%s result=%s", project_id, ref, result)
    try:
        from datetime import datetime, timezone

        from models.models import BuildRecord, BuildStatus
        from web.services.build_filters import config_instance_label
        from web.services.snapshot_ci_inplace import prepend_build_record

        pid = result.get("pipeline_id")
        if pid is None:
            return result
        try:
            bn_int = int(pid)
        except (TypeError, ValueError):
            return result
        st_raw = str(result.get("status") or "pending").lower()
        status_map = {
            "success": BuildStatus.SUCCESS,
            "failed": BuildStatus.FAILURE,
            "running": BuildStatus.RUNNING,
            "canceled": BuildStatus.ABORTED,
            "pending": BuildStatus.RUNNING,
            "created": BuildStatus.RUNNING,
            "skipped": BuildStatus.ABORTED,
            "manual": BuildStatus.UNKNOWN,
        }
        st = status_map.get(st_raw, BuildStatus.RUNNING)
        started = None
        ca = result.get("created_at")
        if ca:
            try:
                started = datetime.fromisoformat(str(ca).replace("Z", "+00:00"))
            except ValueError:
                started = None
        if started is None:
            started = datetime.now(tz=timezone.utc)
        inst_key = config_instance_label(inst, kind="gitlab")
        job_key = str(result.get("project_id") or project_id)
        branch = str(result.get("ref") or ref or "main")
        rec = BuildRecord(
            source="gitlab",
            source_instance=inst_key,
            job_name=job_key,
            build_number=bn_int,
            status=st,
            started_at=started,
            duration_seconds=None,
            branch=branch,
            url=result.get("web_url"),
            critical=_gitlab_project_critical(inst, project_id),
        )
        prepend_build_record(rec)
    except Exception as exc:
        logger.warning("Snapshot patch after GitLab trigger (non-fatal): %s", exc)
    return result


def docker_host_cfg(cfg: dict, docker_host: str) -> dict | None:
    host = str(docker_host or "").strip()
    if not host or host in ("local", "localhost", "127.0.0.1"):
        return None
    for item in cfg.get("docker_monitor", {}).get("docker_hosts", []) or []:
        if not isinstance(item, dict):
            continue
        cand = str(item.get("host") or "").strip()
        name = str(item.get("name") or "").strip()
        if host in (cand, name):
            return item
    return {"host": host, "name": host}


def docker_container_action(*, cfg: dict, container_name: str, action: str, docker_host: str = "") -> Any:
    from docker_monitor.monitor import DockerMonitor

    host_cfg = docker_host_cfg(cfg, docker_host)
    logger.info(
        "Trigger Docker action: action=%s container=%s docker_host=%s",
        action,
        container_name,
        DockerMonitor._docker_host_label(host_cfg),  # pylint: disable=protected-access
    )
    result = DockerMonitor.container_action(container_name, action, docker_host=host_cfg)
    logger.info("Docker action response: action=%s container=%s result=%s", action, container_name, result)
    try:
        from web.services.snapshot_docker_inplace import apply_docker_service_to_latest_snapshot

        apply_docker_service_to_latest_snapshot(
            container_name=container_name,
            docker_host_label=str(result.get("docker_host") or ""),
            docker_state=str(result.get("status") or ""),
        )
    except Exception as exc:
        logger.warning("Snapshot patch after docker action (non-fatal): %s", exc)
    return result
