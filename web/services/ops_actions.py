"""Action endpoints logic (trigger builds / docker actions) extracted from ``web.app``."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException


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
    return client.trigger_build(job_name)


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


def docker_container_action(*, container_name: str, action: str) -> Any:
    from docker_monitor.monitor import DockerMonitor

    return DockerMonitor.container_action(container_name, action)
