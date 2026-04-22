"""Action endpoints logic (trigger builds / docker actions) extracted from ``web.app``."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException

logger = logging.getLogger(__name__)


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
    return client.trigger_pipeline(project_id, ref=ref)


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
    return result
