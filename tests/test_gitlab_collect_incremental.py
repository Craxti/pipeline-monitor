from __future__ import annotations

import logging
from datetime import datetime, timezone
from unittest.mock import MagicMock

from models.models import BuildRecord, BuildStatus, CISnapshot
from web.services.collect_sync import gitlab_collect as gl_mod


def _gitlab_cfg() -> dict:
    return {
        "gitlab_instances": [
            {
                "name": "GitLab Test",
                "enabled": True,
                "url": "https://gitlab.example.com",
                "token": "tok",
                "projects": [{"id": "grp/proj", "critical": False}],
                "max_pipelines": 5,
                "show_all_projects": False,
                "verify_ssl": True,
            }
        ]
    }


def test_incremental_skip_disabled_when_snapshot_missing_gitlab(monkeypatch) -> None:
    snapshot = CISnapshot(
        collected_at=datetime.now(tz=timezone.utc),
        builds=[
            BuildRecord(
                source="jenkins",
                source_instance="J1",
                job_name="job",
                build_number=1,
                status=BuildStatus.SUCCESS,
            )
        ],
    )
    merged: list[BuildRecord] = []
    fake_client = MagicMock()
    fake_client.show_all = False
    fake_client.projects = [{"id": "grp/proj", "critical": False}]
    fake_client._resolve_project.return_value = "1"
    fake_client.fetch_pipelines_for_project.return_value = [
        BuildRecord(
            source="gitlab",
            source_instance="GitLab Test",
            job_name="grp/proj",
            build_number=99,
            status=BuildStatus.SUCCESS,
        )
    ]

    monkeypatch.setattr("clients.gitlab_client.GitLabClient", lambda **kwargs: fake_client)

    gl_mod.collect_gitlab_builds(
        cfg=_gitlab_cfg(),
        since=None,
        snapshot=snapshot,
        progress=lambda *a, **k: None,
        merge_build_records=lambda recs: merged.extend(recs),
        health=[],
        config_instance_label=lambda inst, kind="gitlab": inst.get("name", "GitLab Test"),
        logger=logging.getLogger(__name__),
        incremental_collect=True,
        get_collector_state_int=lambda key, default=0: 1000,
        set_collector_state_int=lambda key, value: None,
        sqlite_available=True,
        check_cancelled=lambda: None,
    )

    fake_client._get.assert_not_called()
    fake_client.fetch_pipelines_for_project.assert_called_once()
    assert len(merged) == 1
    assert merged[0].source == "gitlab"


def test_snapshot_has_gitlab_for_instance_helper() -> None:
    snap = CISnapshot(
        collected_at=datetime.now(tz=timezone.utc),
        builds=[
            BuildRecord(
                source="gitlab",
                source_instance="GL1",
                job_name="a",
                build_number=1,
                status=BuildStatus.SUCCESS,
            )
        ],
    )
    assert gl_mod._snapshot_has_gitlab_for_instance(snap, "GL1") is True
    assert gl_mod._snapshot_has_gitlab_for_instance(snap, "GL2") is False
