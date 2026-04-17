from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient


class TestRequestIdMiddleware:
    def test_sets_header_and_allows_custom_incoming(self) -> None:
        from web.services import request_id as rid_mod

        app = FastAPI()

        @app.middleware("http")
        async def _mw(request: Request, call_next):
            return await rid_mod.add_request_id_middleware(request, call_next)

        @app.get("/ping")
        async def _ping(request: Request):
            return {"rid": rid_mod.rid(request)}

        c = TestClient(app)

        r1 = c.get("/ping")
        assert r1.status_code == 200
        assert "X-Request-ID" in r1.headers
        assert r1.json()["rid"] == r1.headers["X-Request-ID"]

        r2 = c.get("/ping", headers={"X-Request-ID": "my-id"})
        assert r2.status_code == 200
        assert r2.headers["X-Request-ID"] == "my-id"
        assert r2.json()["rid"] == "my-id"

    def test_rid_none_returns_dash(self) -> None:
        from web.services import request_id as rid_mod

        assert rid_mod.rid(None) == "-"


class TestBuildFilters:
    class _B:
        def __init__(self, *, source: str, url: str | None = None, source_instance: str | None = None):
            self.source = source
            self.url = url
            self.source_instance = source_instance

    def test_enabled_ci_bases_skips_disabled_and_trims_slash(self) -> None:
        from web.services.build_filters import enabled_ci_bases

        cfg = {
            "jenkins_instances": [
                {"enabled": True, "url": "https://j.example.com/"},
                {"enabled": False, "url": "https://disabled.example.com/"},
                {"enabled": True, "url": ""},
            ]
        }
        assert enabled_ci_bases(cfg, "jenkins") == ["https://j.example.com"]

    def test_build_url_matches_base_case_insensitive(self) -> None:
        from web.services.build_filters import build_url_matches_ci_bases

        b = self._B(source="jenkins", url="https://J.EXAMPLE.COM/job/a/1/")
        assert build_url_matches_ci_bases(b, ["https://j.example.com"]) is True

    def test_build_url_path_only_is_joined_against_base(self) -> None:
        from web.services.build_filters import build_url_matches_ci_bases

        b = self._B(source="jenkins", url="/job/a/1/")
        assert build_url_matches_ci_bases(b, ["https://j.example.com"]) is True

    def test_is_snapshot_build_enabled_filters_by_configured_bases(self) -> None:
        from web.services.build_filters import is_snapshot_build_enabled

        cfg = {"jenkins_instances": [{"enabled": True, "url": "https://j.example.com"}]}
        b_ok = self._B(source="jenkins", url="https://j.example.com/job/a/1/")
        b_bad = self._B(source="jenkins", url="https://other/job/a/1/")
        assert is_snapshot_build_enabled(b_ok, cfg) is True
        assert is_snapshot_build_enabled(b_bad, cfg) is False

    def test_inst_label_prefers_stored_source_instance(self) -> None:
        from web.services.build_filters import inst_label_for_build_with_cfg

        b = self._B(source="jenkins", url="https://j.example.com/job/a/1/", source_instance="My Jenkins")
        assert inst_label_for_build_with_cfg(b, {"jenkins_instances": []}) == "My Jenkins"

    def test_inst_label_infers_from_url_and_config_name(self) -> None:
        from web.services.build_filters import inst_label_for_build_with_cfg

        cfg = {"jenkins_instances": [{"enabled": True, "name": "J1", "url": "https://j.example.com"}]}
        b = self._B(source="jenkins", url="https://j.example.com/job/a/1/")
        assert inst_label_for_build_with_cfg(b, cfg) == "J1"


class TestEventFeedPersistence:
    def test_slim_event_keeps_only_expected_fields(self) -> None:
        from web.core.event_feed import slim_event

        raw = {
            "id": 1,
            "ts": "2026-04-17T00:00:00Z",
            "kind": "build",
            "level": "info",
            "title": "ok",
            "detail": "x",
            "url": "http://x",
            "critical": True,
            "extra": {"leak": "no"},
        }
        out = slim_event(raw)
        assert out["id"] == 1
        assert out["url"] == "http://x"
        assert out["critical"] is True
        assert "extra" not in out

    def test_append_and_load_caps_max_entries(self, tmp_path: Path) -> None:
        from web.core.event_feed import append_events, load_events

        p = tmp_path / "event_feed.json"
        append_events([{"id": 1, "ts": "t1"}], path=p, max_entries=2)
        append_events([{"id": 2, "ts": "t2"}], path=p, max_entries=2)
        append_events([{"id": 3, "ts": "t3"}], path=p, max_entries=2)

        raw = json.loads(p.read_text(encoding="utf-8"))
        assert [x["id"] for x in raw] == [2, 3]

        loaded = load_events(300, path=p)
        assert [x["id"] for x in loaded] == [2, 3]

    def test_load_invalid_json_returns_empty(self, tmp_path: Path) -> None:
        from web.core.event_feed import load_events

        p = tmp_path / "event_feed.json"
        p.write_text("not json", encoding="utf-8")
        assert load_events(50, path=p) == []


class TestEventsEndpoints:
    def test_limit_is_clamped_to_1_500(self) -> None:
        from web.services.events_endpoints import api_events_persisted

        seen = {"limit": None}

        def loader(lim: int):
            seen["limit"] = lim
            return [{"id": 1}]

        api_events_persisted(event_feed_load=loader, limit=-10)
        assert seen["limit"] == 1

        api_events_persisted(event_feed_load=loader, limit=999999)
        assert seen["limit"] == 500


class TestStatusEndpoints:
    def test_returns_404_jsonresponse_when_no_snapshot(self) -> None:
        from web.services import status_endpoints

        out = status_endpoints.api_status(
            load_snapshot=lambda: None,
            load_yaml_config=lambda: {},
            is_snapshot_build_enabled=lambda b, cfg: True,
            inst_label_for_build_with_cfg=lambda b, cfg: "",
        )
        assert isinstance(out, JSONResponse)
        assert out.status_code == 404

    def test_filters_builds_by_enabled_sources(self) -> None:
        from models.models import CISnapshot, BuildRecord, BuildStatus
        from web.services import status_endpoints
        from web.services.build_filters import is_snapshot_build_enabled, inst_label_for_build_with_cfg

        cfg = {"jenkins_instances": [{"enabled": True, "name": "J1", "url": "https://j.example.com"}]}
        snap = CISnapshot(
            builds=[
                BuildRecord(
                    source="jenkins",
                    job_name="a",
                    build_number=1,
                    status=BuildStatus.SUCCESS,
                    url="https://j.example.com/job/a/1/",
                ),
                BuildRecord(
                    source="jenkins",
                    job_name="b",
                    build_number=2,
                    status=BuildStatus.SUCCESS,
                    url="https://other/job/b/2/",
                ),
            ]
        )

        out = status_endpoints.api_status(
            load_snapshot=lambda: snap,
            load_yaml_config=lambda: cfg,
            is_snapshot_build_enabled=is_snapshot_build_enabled,
            inst_label_for_build_with_cfg=inst_label_for_build_with_cfg,
        )
        assert isinstance(out, dict)
        assert len(out["builds"]) == 1
        assert out["builds"][0]["job_name"] == "a"


class TestBuildsEndpoints:
    def test_api_builds_filters_instance_and_status(self) -> None:
        from models.models import CISnapshot, BuildRecord, BuildStatus
        from web.services import builds_endpoints
        from web.services.build_filters import is_snapshot_build_enabled, inst_label_for_build_with_cfg
        from models.models import normalize_build_status

        cfg = {
            "jenkins_instances": [{"enabled": True, "name": "J1", "url": "https://j.example.com"}],
            "gitlab_instances": [{"enabled": True, "name": "G1", "url": "https://g.example.com"}],
        }
        snap = CISnapshot(
            builds=[
                BuildRecord(
                    source="jenkins",
                    job_name="job-a",
                    build_number=1,
                    status=BuildStatus.SUCCESS,
                    url="https://j.example.com/job/job-a/1/",
                ),
                BuildRecord(
                    source="jenkins",
                    job_name="job-a",
                    build_number=2,
                    status=BuildStatus.FAILURE,
                    url="https://j.example.com/job/job-a/2/",
                ),
                BuildRecord(
                    source="gitlab",
                    job_name="pipe",
                    build_number=3,
                    status=BuildStatus.FAILURE,
                    url="https://g.example.com/x/3/",
                ),
            ]
        )

        async def _load_snapshot_async():
            return snap

        out = asyncio.run(
            builds_endpoints.api_builds(
                load_snapshot_async=_load_snapshot_async,
                load_yaml_config=lambda: cfg,
                is_snapshot_build_enabled=is_snapshot_build_enabled,
                inst_label_for_build_with_cfg=lambda b, c: (inst_label_for_build_with_cfg(b, c) or ""),
                normalize_build_status=normalize_build_status,
                job_build_analytics=lambda s: {},
                page=1,
                per_page=50,
                source="jenkins",
                instance="J1",
                status="failure",
                job="job-a",
                hours=0,
            )
        )
        assert out["total"] == 1
        assert out["items"][0]["build_number"] == 2

