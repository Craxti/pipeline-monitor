"""
E2E smoke tests — start the FastAPI app with TestClient and hit real endpoints.
No real Jenkins/GitLab/Docker connections are made; the app may return 404 if
there may be no collected snapshot in `monitor.db` yet, which is still a valid response (server is up).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Change working directory so the app can find config.yaml and data/
import os

os.chdir(ROOT)

from fastapi.testclient import TestClient
from web.app import app

client = TestClient(app, raise_server_exceptions=False)


class TestSmoke:
    def test_root_returns_html(self) -> None:
        resp = client.get("/")
        assert resp.status_code == 200
        assert "text/html" in resp.headers["content-type"]

    def test_api_status_responds(self) -> None:
        resp = client.get("/api/status")
        # Either 200 (snapshot exists) or 404 (no data yet) — both are OK
        assert resp.status_code in (200, 404)
        assert resp.headers["content-type"].startswith("application/json")

    def test_api_builds_responds(self) -> None:
        resp = client.get("/api/builds")
        assert resp.status_code in (200, 404)

    def test_api_tests_responds(self) -> None:
        resp = client.get("/api/tests")
        assert resp.status_code in (200, 404)

    def test_api_services_responds(self) -> None:
        resp = client.get("/api/services")
        assert resp.status_code in (200, 404)

    def test_api_top_failures_responds(self) -> None:
        resp = client.get("/api/tests/top-failures")
        assert resp.status_code in (200, 404)

    def test_api_trends_responds(self) -> None:
        resp = client.get("/api/trends")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_api_meta_responds(self) -> None:
        resp = client.get("/api/meta")
        assert resp.status_code == 200
        data = resp.json()
        assert "data_revision" in data
        assert "snapshot" in data
        assert "correlation" in data
        assert "X-Request-ID" in resp.headers

    def test_api_export_incident(self) -> None:
        for path in (
            "/api/export/incident?fmt=json",
            "/api/export/incident.json",
            "/api/export/incident/json",
            "/api/incident",
            "/api/export/incident?fmt=md",
            "/api/export/incident.md",
            "/api/export/incident/md",
            "/api/incident.json",
            "/api/incident.md",
            "/api/incident?fmt=md",
        ):
            resp = client.get(path)
            assert resp.status_code == 200, path

    def test_incident_browser_html(self) -> None:
        r = client.get("/api/incident.json", headers={"Accept": "text/html"})
        assert r.status_code == 200
        assert "text/html" in (r.headers.get("content-type") or "")
        assert "<html" in r.text.lower()

        r_md = client.get("/api/incident.md", headers={"Accept": "text/html"})
        assert r_md.status_code == 200
        assert "text/html" in (r_md.headers.get("content-type") or "")

    def test_incident_raw_skips_html(self) -> None:
        r = client.get(
            "/api/incident.json?raw=1",
            headers={"Accept": "text/html"},
        )
        assert r.status_code == 200
        assert "application/json" in (r.headers.get("content-type") or "")
        assert isinstance(r.json(), dict)

    def test_health_includes_request_id(self) -> None:
        resp = client.get("/health")
        assert resp.status_code == 200
        assert "X-Request-ID" in resp.headers

    def test_api_collect_status_responds(self) -> None:
        resp = client.get("/api/collect/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "is_collecting" in data
        assert "interval_seconds" in data

    def test_api_settings_returns_dict(self) -> None:
        resp = client.get("/api/settings")
        assert resp.status_code == 200
        assert isinstance(resp.json(), dict)

    def test_api_settings_masks_tokens(self) -> None:
        resp = client.get("/api/settings")
        assert resp.status_code == 200
        data = resp.json()
        for inst in data.get("jenkins_instances") or []:
            tok = str(inst.get("token") or "")
            if len(tok) > 10:
                assert "•" in tok
        for inst in data.get("gitlab_instances") or []:
            tok = str(inst.get("token") or "")
            if len(tok) > 10:
                assert "•" in tok
        px = (data.get("openai") or {}).get("proxy") or {}
        pw = str(px.get("password") or "")
        if len(pw) > 3:
            assert "•" in pw

    def test_api_settings_public(self) -> None:
        resp = client.get("/api/settings/public")
        assert resp.status_code == 200
        j = resp.json()
        assert "ui_language" in j
        assert "web" in j
        assert "port" in j["web"]

    def test_api_dashboard_summary(self) -> None:
        resp = client.get("/api/dashboard/summary")
        assert resp.status_code == 200
        j = resp.json()
        assert "counts" in j
        assert "partial_errors" in j
        assert "instance_health" in j

    def test_api_instances_health(self) -> None:
        resp = client.get("/api/instances/health")
        assert resp.status_code == 200
        j = resp.json()
        assert "instances" in j

    def test_api_builds_history(self) -> None:
        resp = client.get("/api/builds/history")
        assert resp.status_code == 200
        j = resp.json()
        assert "items" in j
        assert j.get("source") in ("sqlite", "none")

    def test_settings_page_returns_html(self) -> None:
        resp = client.get("/settings")
        assert resp.status_code == 200
        assert "text/html" in resp.headers["content-type"]

    def test_api_sources_returns_list(self) -> None:
        resp = client.get("/api/sources")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_unknown_route_returns_404(self) -> None:
        resp = client.get("/nonexistent-path-xyz")
        assert resp.status_code == 404
