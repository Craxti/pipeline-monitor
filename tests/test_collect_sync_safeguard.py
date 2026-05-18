from __future__ import annotations

import logging
from datetime import datetime, timezone

from models.models import CISnapshot, TestRecord as ModelTestRecord
from web.services.collect_sync import run_collect_sync as run_collect_sync_mod


def test_preserves_previous_tests_when_sources_fail_and_current_cycle_has_no_tests(monkeypatch) -> None:
    prev_snapshot = CISnapshot(
        collected_at=datetime.now(tz=timezone.utc),
        tests=[
            ModelTestRecord(
                source="jenkins_console",
                source_instance="Jenkins ARTIMATE",
                suite="suite-a",
                test_name="test_a",
                status="failed",
            )
        ],
    )
    saved: dict = {}
    logs: list[tuple[str, str, str | None, str]] = []

    def _jenkins_fail(**kwargs):
        kwargs["health"].append(
            {
                "name": "Jenkins ARTIMATE",
                "kind": "jenkins",
                "ok": False,
                "error": "upstream 500",
            }
        )

    monkeypatch.setattr(run_collect_sync_mod._jenkins_collect, "collect_jenkins", _jenkins_fail)
    monkeypatch.setattr(
        run_collect_sync_mod._gitlab_collect,
        "collect_gitlab_builds",
        lambda **kwargs: None,
    )
    monkeypatch.setattr(
        run_collect_sync_mod._local_parsers,
        "parse_local_test_dirs",
        lambda **kwargs: None,
    )
    monkeypatch.setattr(
        run_collect_sync_mod._docker_collect,
        "collect_docker_services",
        lambda **kwargs: None,
    )

    run_collect_sync_mod.run_collect_sync(
        cfg={
            "general": {"default_lookback_days": 7},
            "jenkins_instances": [{"enabled": True, "parse_console": True, "parse_allure": True}],
            "gitlab_instances": [],
            "docker_monitor": {"enabled": False},
            "parsers": {"pytest_xml_dirs": [], "allure_json_dirs": []},
        },
        force_full=False,
        CISnapshot=CISnapshot,
        TestRecord=ModelTestRecord,
        load_snapshot=lambda: prev_snapshot,
        save_snapshot=lambda snap: saved.setdefault("snapshot", snap),
        maybe_save_partial=lambda *_a, **_k: None,
        collect_state={},
        push_collect_log=lambda phase, main, sub=None, level="info": logs.append((phase, main, sub, level)),
        collect_slow=[],
        instance_health_setter=lambda _h: None,
        config_instance_label=lambda _inst, kind="jenkins": kind,
        sqlite_available=False,
        get_collector_state_int=lambda *_a, **_k: 0,
        set_collector_state_int=lambda *_a, **_k: None,
        logger=logging.getLogger(__name__),
    )

    out = saved["snapshot"]
    assert len(out.tests) == 1
    assert out.tests[0].test_name == "test_a"
    assert any(x[0] == "tests" and x[3] == "warn" for x in logs)
