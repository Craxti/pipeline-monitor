"""
Contract tests: settings masking/merge, SQLite history query, status normalization helpers.
"""

from __future__ import annotations

import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

from models.models import BuildRecord, BuildStatus, CISnapshot, normalize_build_status, normalize_test_status
from web import db as dbmod
from web.app import (
    _SETTINGS_SECRET_MASK,
    _mask_settings_for_response,
    _merge_settings_secrets,
)


class TestSettingsMaskMerge:
    def test_mask_replaces_secret_strings(self) -> None:
        cfg = {
            "jenkins_instances": [{"name": "J1", "url": "http://x", "token": "secret-token-xyz"}],
            "nested": {"api_key": "k9"},
        }
        out = _mask_settings_for_response(cfg)
        assert out["jenkins_instances"][0]["token"] == _SETTINGS_SECRET_MASK
        assert out["nested"]["api_key"] == _SETTINGS_SECRET_MASK
        assert out["jenkins_instances"][0]["url"] == "http://x"

    def test_merge_keeps_saved_secret_when_mask_sent(self) -> None:
        saved = {"openai": {"token": "real-secret", "model": "gpt-4"}}
        incoming = {"openai": {"token": _SETTINGS_SECRET_MASK, "model": "gpt-4o"}}
        merged = _merge_settings_secrets(incoming, saved)
        assert merged["openai"]["token"] == "real-secret"
        assert merged["openai"]["model"] == "gpt-4o"

    def test_merge_nested_instance_list_by_index(self) -> None:
        saved = {
            "gitlab_instances": [
                {"name": "G1", "url": "https://g", "token": "oldtok"},
                {"name": "G2", "url": "https://h", "token": "tok2"},
            ]
        }
        incoming = {
            "gitlab_instances": [
                {"name": "G1", "url": "https://g", "token": _SETTINGS_SECRET_MASK},
                {"name": "G2", "url": "https://h", "token": "newsecond"},
            ]
        }
        merged = _merge_settings_secrets(incoming, saved)
        assert merged["gitlab_instances"][0]["token"] == "oldtok"
        assert merged["gitlab_instances"][1]["token"] == "newsecond"


class TestNormalizeHelpers:
    def test_normalize_build_status_aliases(self) -> None:
        assert normalize_build_status("FAILURE") == "failure"
        assert normalize_build_status("success") == "success"

    def test_normalize_test_status_aliases(self) -> None:
        assert normalize_test_status("FAIL") == "failed"
        assert normalize_test_status("pass") == "passed"


class TestQueryBuildsHistory:
    def test_status_filter_accepts_mixed_case_query(self) -> None:
        old_path = dbmod._DB_PATH
        try:
            with tempfile.TemporaryDirectory() as td:
                dbmod.init_db(td)
                now = datetime.now(tz=timezone.utc)
                snap = CISnapshot(
                    collected_at=now,
                    builds=[
                        BuildRecord(
                            source="jenkins",
                            job_name="job-a",
                            build_number=1,
                            status=BuildStatus.SUCCESS,
                            started_at=now,
                        ),
                        BuildRecord(
                            source="jenkins",
                            job_name="job-a",
                            build_number=2,
                            status=BuildStatus.FAILURE,
                            started_at=now,
                        ),
                    ],
                )
                dbmod.append_snapshot(snap)
                r = dbmod.query_builds_history(
                    job="job-a",
                    status="FAILURE",
                    page=1,
                    per_page=10,
                    days=30,
                )
                assert r["total"] == 1
                assert r["items"][0]["status"] == "failure"
                assert r["items"][0]["job_name"] == "job-a"
        finally:
            dbmod._DB_PATH = old_path
            if old_path is not None:
                dbmod.init_db(old_path.parent)
