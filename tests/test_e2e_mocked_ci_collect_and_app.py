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
