"""Log viewers and diff helpers extracted from ``web.app``."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from web.services.ops_actions import find_gitlab_instance, find_jenkins_instance


def fetch_jenkins_log(*, cfg: dict, job_name: str, build_number: int, instance_url: str = "") -> dict[str, Any]:
    if instance_url:
        inst = find_jenkins_instance(cfg, instance_url)
        insts = [inst] if inst else []
    else:
        insts = [i for i in cfg.get("jenkins_instances", []) if i.get("enabled", True)]

    last_err: str | None = None
    from clients.jenkins_client import JenkinsClient

    for inst in insts:
        try:
            client = JenkinsClient(
                url=inst["url"],
                username=inst.get("username", ""),
                token=inst.get("token", ""),
                verify_ssl=bool(inst.get("verify_ssl", True)),
            )
            text = client.fetch_console_text(job_name, build_number)
            return {"ok": True, "log": text, "instance": inst.get("url", "")}
        except Exception as exc:
            last_err = str(exc)

    raise HTTPException(502, detail=last_err or "Could not fetch Jenkins console log")


def fetch_gitlab_log(*, cfg: dict, project_id: str, pipeline_id: int, instance_url: str = "") -> dict[str, Any]:
    if instance_url:
        inst = find_gitlab_instance(cfg, instance_url)
        insts = [inst] if inst else []
    else:
        insts = [i for i in cfg.get("gitlab_instances", []) if i.get("enabled", True)]

    last_err: str | None = None
    from clients.gitlab_client import GitLabClient

    for inst in insts:
        try:
            client = GitLabClient(
                url=inst.get("url", "https://gitlab.com"),
                token=inst.get("token", ""),
            )
            text = client.fetch_pipeline_logs(project_id, pipeline_id)
            return {"ok": True, "log": text, "instance": inst.get("url", "")}
        except Exception as exc:
            last_err = str(exc)

    raise HTTPException(502, detail=last_err or "Could not fetch GitLab pipeline logs")


def diff_logs(
    *,
    source: str,
    job_name: str,
    build_number: int,
    instance_url: str,
    cfg: dict,
    snapshot: Any,
) -> dict[str, Any]:
    import difflib

    if snapshot is None:
        raise HTTPException(404, "No snapshot data")

    def _same_job_rows() -> list:
        return [
            b
            for b in snapshot.builds
            if (b.source or "").lower() == source.lower()
            and b.job_name == job_name
            and b.build_number != build_number
        ]

    prev_build_number: int | None = None
    reference_kind = ""
    reference_status: str | None = None

    same_job_success = [b for b in _same_job_rows() if b.status_normalized == "success"]
    same_job_any = _same_job_rows()
    if same_job_success:
        same_job_success.sort(key=lambda b: b.started_at or datetime.min, reverse=True)
        prev_build_number = int(same_job_success[0].build_number)
        reference_kind = "last_success"
        reference_status = same_job_success[0].status
    elif same_job_any:
        same_job_any.sort(key=lambda b: b.started_at or datetime.min, reverse=True)
        prev_build_number = int(same_job_any[0].build_number)
        reference_kind = "last_build"
        reference_status = same_job_any[0].status

    cur_text = prev_text = ""
    last_fetch_err: str | None = None

    if source.lower() == "jenkins":
        from clients.jenkins_client import JenkinsClient

        insts = (
            [find_jenkins_instance(cfg, instance_url)]
            if instance_url
            else [i for i in cfg.get("jenkins_instances", []) if i.get("enabled", True)]
        )
        for inst in (i for i in insts if i):
            try:
                client = JenkinsClient(
                    url=inst.get("url", ""),
                    username=inst.get("username", ""),
                    token=inst.get("token", ""),
                )
                cur_text = client.fetch_console_text(job_name, build_number)

                if prev_build_number is None:
                    ref = client.fetch_reference_build_number(job_name, prefer_success=True)
                    if ref is not None and int(ref) != int(build_number):
                        prev_build_number = int(ref)
                        reference_kind = "jenkins_last_success"
                        reference_status = "success"
                    else:
                        ref2 = client.fetch_reference_build_number(job_name, prefer_success=False)
                        if ref2 is not None and int(ref2) != int(build_number):
                            prev_build_number = int(ref2)
                            reference_kind = "jenkins_last_completed"
                            reference_status = "unknown"

                if prev_build_number is None:
                    raise HTTPException(
                        404,
                        f"No other build for «{job_name}» in snapshot (and no reference build resolved from Jenkins) — run collect to refresh data.",
                    )

                prev_text = client.fetch_console_text(job_name, int(prev_build_number))
                break
            except Exception as exc:
                last_fetch_err = str(exc)
    elif source.lower() == "gitlab":
        from clients.gitlab_client import GitLabClient

        insts = (
            [find_gitlab_instance(cfg, instance_url)]
            if instance_url
            else [i for i in cfg.get("gitlab_instances", []) if i.get("enabled", True)]
        )
        for inst in (i for i in insts if i):
            try:
                client = GitLabClient(url=inst.get("url", ""), token=inst.get("token", ""))
                cur_text = client.fetch_pipeline_logs(job_name, build_number)
                if prev_build_number is None:
                    raise HTTPException(
                        404,
                        f"No other build for «{job_name}» in snapshot — run collect to refresh data.",
                    )
                prev_text = client.fetch_pipeline_logs(job_name, int(prev_build_number))
                break
            except Exception as exc:
                last_fetch_err = str(exc)
    else:
        raise HTTPException(400, f"Diff not supported for source: {source}")

    if not cur_text:
        raise HTTPException(
            502, "Could not fetch current build log" + (f": {last_fetch_err}" if last_fetch_err else "")
        )
    if not prev_text:
        raise HTTPException(
            502, "Could not fetch reference build log" + (f": {last_fetch_err}" if last_fetch_err else "")
        )

    cur_lines = cur_text.splitlines()
    prev_lines = prev_text.splitlines()
    diff = list(difflib.unified_diff(prev_lines, cur_lines, lineterm="", n=4))

    return {
        "ok": True,
        "current_build": build_number,
        "reference_build": prev_build_number,
        "reference_status": reference_status,
        "reference_kind": reference_kind,
        "diff": diff,
        "cur_lines": len(cur_lines),
        "prev_lines": len(prev_lines),
    }


def pipeline_stages(*, cfg: dict, project_id: str, pipeline_id: int, instance_url: str = "") -> dict[str, Any]:
    if instance_url:
        inst = find_gitlab_instance(cfg, instance_url)
        insts = [inst] if inst else []
    else:
        insts = [i for i in cfg.get("gitlab_instances", []) if i.get("enabled", True)]

    from clients.gitlab_client import GitLabClient

    last_err: str | None = None
    for inst in insts:
        try:
            client = GitLabClient(url=inst.get("url", "https://gitlab.com"), token=inst.get("token", ""))
            base = inst.get("url", "https://gitlab.com").rstrip("/")
            pid_enc = project_id.replace("/", "%2F")
            resp = client.session.get(
                f"{base}/api/v4/projects/{pid_enc}/pipelines/{pipeline_id}/jobs",
                params={"per_page": 100},
                timeout=client.timeout,
            )
            resp.raise_for_status()
            jobs = resp.json()
            stages: dict[str, list[dict]] = {}
            for j in jobs:
                stage = j.get("stage", "unknown")
                stages.setdefault(stage, []).append(
                    {
                        "name": j.get("name", ""),
                        "status": j.get("status", "unknown"),
                        "duration": j.get("duration"),
                        "web_url": j.get("web_url"),
                        "id": j.get("id"),
                    }
                )
            ordered = [{"stage": stage_name, "jobs": jobs_list} for stage_name, jobs_list in stages.items()]
            return {"ok": True, "stages": ordered}
        except Exception as exc:
            last_err = str(exc)
    raise HTTPException(502, detail=last_err or "Could not fetch pipeline stages")


def docker_logs_tail(*, container: str, tail: int = 4000) -> dict[str, Any]:
    from docker_monitor.monitor import DockerMonitor

    text = DockerMonitor.container_logs_tail(container, tail=max(100, min(int(tail), 50_000)))
    return {"ok": True, "log": text}


def docker_logs_stream_response(*, container: str) -> StreamingResponse:
    from docker_monitor.monitor import DockerMonitor

    def gen():
        yield from DockerMonitor.iter_container_logs_stream(container, follow=True, tail=200, timestamps=True)

    return StreamingResponse(gen(), media_type="text/plain; charset=utf-8")
