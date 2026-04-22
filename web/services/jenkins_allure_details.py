"""Resolve Jenkins + Allure test-case JSON / attachments for dashboard API (server-side auth)."""

from __future__ import annotations

from typing import Any

from clients.jenkins_client import JenkinsClient
from parsers.allure_rich_meta import (
    allure_image_attachments_from_case,
    allure_plain_description_from_case,
    normalize_allure_data_relative_path,
)
from web.services.build_filters import config_instance_label


def resolve_jenkins_instance(cfg: dict[str, Any], source_instance: str | None) -> dict[str, Any] | None:
    want = (source_instance or "").strip()
    insts = [i for i in (cfg.get("jenkins_instances", []) or []) if i.get("enabled", True)]
    if not insts:
        return None
    if want:
        for inst in insts:
            if config_instance_label(inst, kind="jenkins") == want:
                return inst
        return None
    # Snapshot row may omit ``source_instance``; a single Jenkins entry is unambiguous.
    if len(insts) == 1:
        return insts[0]
    return None


def build_jenkins_client(inst: dict[str, Any]) -> JenkinsClient | None:
    url = str(inst.get("url") or "").strip()
    if not url:
        return None
    key = config_instance_label(inst, kind="jenkins")
    return JenkinsClient(
        url=url,
        username=str(inst.get("username") or ""),
        token=str(inst.get("token") or ""),
        jobs=[],
        timeout=int(inst.get("timeout", 30) or 30),
        verify_ssl=bool(inst.get("verify_ssl", True)),
        source_instance=key,
    )


def fetch_allure_details_payload(
    cfg: dict[str, Any],
    *,
    source_instance: str | None,
    suite: str,
    build_number: int,
    uid: str,
) -> dict[str, Any] | None:
    """Return ``{ description, description_html, attachments }`` or ``None`` if unavailable."""
    inst = resolve_jenkins_instance(cfg, source_instance)
    if not inst:
        return None
    client = build_jenkins_client(inst)
    if not client:
        return None
    job = (suite or "").strip()
    if not job:
        return None
    try:
        bn = int(build_number)
    except (TypeError, ValueError):
        return None
    case = client.fetch_allure_case_dict(job, bn, uid)
    if not case:
        return None
    desc_plain = allure_plain_description_from_case(case, max_len=16000)
    desc_html = case.get("descriptionHtml") if isinstance(case.get("descriptionHtml"), str) else None
    if not desc_html and isinstance(case.get("description"), str) and "<" in str(case.get("description")):
        desc_html = str(case.get("description"))
    atts = allure_image_attachments_from_case(case)
    return {
        "description": desc_plain,
        "description_html": desc_html,
        "attachments": atts,
    }


def fetch_allure_attachment_bytes(
    cfg: dict[str, Any],
    *,
    source_instance: str | None,
    suite: str,
    build_number: int,
    src: str,
) -> tuple[bytes, str | None] | None:
    inst = resolve_jenkins_instance(cfg, source_instance)
    if not inst:
        return None
    client = build_jenkins_client(inst)
    if not client:
        return None
    job = (suite or "").strip()
    if not job:
        return None
    try:
        bn = int(build_number)
    except (TypeError, ValueError):
        return None
    rel = normalize_allure_data_relative_path(src)
    if not rel:
        return None
    return client.fetch_allure_data_bytes(job, bn, rel)
