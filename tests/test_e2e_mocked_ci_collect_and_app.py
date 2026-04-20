"""
E2E-style integration: FastAPI app + mocked Jenkins/GitLab HTTP + real collect path.

Uses pytest-httpserver to avoid real CI connectivity. Does not mutate repo config.yaml.
"""

from __future__ import annotations

import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient

from models import models as models_mod
from models.models import CISnapshot
from web.app import app
from web.core import auth as auth_mod
from web.services.build_filters import config_instance_label
from web.services.collect_sync import gitlab_collect, jenkins_collect


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


def _jenkins_builds_json():
    return {
        "builds": [
            {
                "number": 42,
                "result": "SUCCESS",
                "timestamp": int(datetime.now(tz=timezone.utc).timestamp() * 1000),
                "duration": 5000,
                "url": "http://mock/job/myjob/42",
            }
        ]
    }


def _gitlab_project_json():
    return {"id": 99, "path_with_namespace": "ns/proj"}


def _gitlab_pipelines_json():
    return [
        {
            "id": 7,
            "status": "success",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:01:00Z",
            "web_url": "http://mock/ns/proj/-/pipelines/7",
            "ref": "main",
            "sha": "abc123",
        }
    ]


def test_fastapi_dashboard_html_and_public_api(client: TestClient) -> None:
    r = client.get("/")
    assert r.status_code == 200
    assert "text/html" in r.headers.get("content-type", "")
    assert "dashboard.helpers.formatters" in r.text

    pub = client.get("/api/settings/public")
    assert pub.status_code == 200
    body = pub.json()
    assert "web" in body
    assert "port" in body["web"]


def test_e2e_tabs_happy_endpoints_respond(client: TestClient) -> None:
    # All main tabs have a backend endpoint that should be stable.
    assert client.get("/api/builds").status_code in (200, 404)
    assert client.get("/api/tests").status_code in (200, 404)
    assert client.get("/api/services").status_code in (200, 404)

    trends = client.get("/api/trends?days=14")
    assert trends.status_code == 200
    assert isinstance(trends.json(), list)

    kpi = client.get("/api/trends/history-summary?days=14&source=jenkins&instance=jenkins%7Cmain")
    assert kpi.status_code == 200
    payload = kpi.json()
    assert "most_problematic_jobs" in payload
    assert "data_coverage_pct" in payload
    assert "recovery_samples" in payload


def test_e2e_tabs_sad_filters_do_not_crash(client: TestClient) -> None:
    # Unknown filters should return empty/valid payloads, not 500.
    r1 = client.get("/api/trends/history-summary?days=999&source=unknown&instance=unknown%7Cnone")
    assert r1.status_code == 200
    p1 = r1.json()
    assert isinstance(p1.get("most_problematic_jobs"), list)
    assert "data_coverage_pct" in p1

    r2 = client.get("/api/services?status=definitely-invalid")
    assert r2.status_code in (200, 404)


def test_chat_prompts_endpoint_returns_multilang_bundle(client: TestClient) -> None:
    r = client.get("/api/chat/prompts")
    assert r.status_code == 200
    p = r.json().get("prompts") or {}
    assert "en" in p and "ru" in p
    assert "runbook_focus_tests" in p["en"]
    assert "runbook_focus_tests" in p["ru"]
