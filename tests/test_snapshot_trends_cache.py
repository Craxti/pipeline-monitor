from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from models.models import BuildRecord, BuildStatus, CISnapshot, ServiceStatus
from models.models import TestRecord as ModelTestRecord


class TestSnapshotCache:
    def test_load_snapshot_returns_none_when_missing(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        from web.core import snapshot_cache as sc

        p = tmp_path / "snapshot.json"
        monkeypatch.setattr(sc, "SNAPSHOT_PATH", p)
        sc.invalidate_snapshot_cache()
        assert sc.load_snapshot() is None

    def test_load_snapshot_caches_by_ttl_and_mtime(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        from web.core import snapshot_cache as sc

        class _FakePath:
            def __init__(self, *, mtime: float, text: str):
                self._mtime = mtime
                self._text = text

            def exists(self) -> bool:
                return True

            def stat(self):
                class _ST:
                    st_mtime = 0.0

                _ST.st_mtime = self._mtime
                return _ST

            def read_text(self, encoding: str = "utf-8") -> str:
                return self._text

        sc.invalidate_snapshot_cache()

        good = CISnapshot(builds=[], tests=[], services=[])
        fake = _FakePath(mtime=123.0, text=good.model_dump_json())
        monkeypatch.setattr(sc, "SNAPSHOT_PATH", fake)

        # First read primes cache
        s1 = sc.load_snapshot()
        assert isinstance(s1, CISnapshot)

        # Keep same mtime and same revision, do not expire TTL: should return cached snapshot even if file is "corrupted"
        fake._text = "not json"
        monkeypatch.setattr(time, "monotonic", lambda: sc._snapshot_cache_expires_mono - 0.1)
        s2 = sc.load_snapshot()
        assert isinstance(s2, CISnapshot)

        # After TTL expires, it should attempt to parse and fail -> None
        monkeypatch.setattr(time, "monotonic", lambda: sc._snapshot_cache_expires_mono + 0.1)
        assert sc.load_snapshot() is None

    def test_load_snapshot_async_uses_thread(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        from web.core import snapshot_cache as sc

        p = tmp_path / "snapshot.json"
        monkeypatch.setattr(sc, "SNAPSHOT_PATH", p)
        sc.invalidate_snapshot_cache()
        p.write_text(CISnapshot().model_dump_json(), encoding="utf-8")

        out = asyncio.run(sc.load_snapshot_async())
        assert isinstance(out, CISnapshot)


class TestTrends:
    def test_append_trends_replaces_today_bucket_and_caps_days(self, tmp_path: Path) -> None:
        from web.core import trends as tr

        hp = tmp_path / "trends.json"
        now = datetime.now(tz=timezone.utc)

        s1 = CISnapshot(
            collected_at=now,
            builds=[
                BuildRecord(
                    source="jenkins",
                    job_name="a",
                    build_number=1,
                    status=BuildStatus.SUCCESS,
                    started_at=now,
                ),
                BuildRecord(
                    source="jenkins",
                    job_name="a",
                    build_number=2,
                    status=BuildStatus.FAILURE,
                    started_at=now,
                ),
            ],
            tests=[
                ModelTestRecord(source="pytest", suite="s", test_name="t1", status="failed"),
                ModelTestRecord(source="pytest", suite="s", test_name="t1", status="failed"),
            ],
            services=[
                ServiceStatus(name="svc", kind="http", status="down", checked_at=now),
            ],
        )
        tr.append_trends(s1, history_path=hp, history_max_days=30)
        first = json.loads(hp.read_text(encoding="utf-8"))
        assert len(first) == 1
        assert first[0]["builds_total"] == 2
        assert first[0]["builds_failed"] == 1
        assert first[0]["tests_failed"] == 2
        assert first[0]["services_down"] == 1

        # Same day again with different totals -> should replace today's entry, not append a second one
        s2 = CISnapshot(collected_at=now, builds=[], tests=[], services=[])
        tr.append_trends(s2, history_path=hp, history_max_days=30)
        second = json.loads(hp.read_text(encoding="utf-8"))
        assert len(second) == 1
        assert second[0]["builds_total"] == 0

    def test_compute_trends_filters_by_cutoff(self, tmp_path: Path) -> None:
        from web.core import trends as tr

        hp = tmp_path / "trends.json"
        now = datetime.now(tz=timezone.utc)
        # Write 3 days of fake history
        days = [(now - timedelta(days=i)).strftime("%Y-%m-%d") for i in (3, 2, 1)]
        data = [{"date": d, "builds_total": 1} for d in days]
        hp.write_text(json.dumps(data), encoding="utf-8")

        out = tr.compute_trends(2, history_path=hp)
        assert len(out) in (2, 3)  # timezone boundary can include/exclude the oldest
        assert all("date" in x for x in out)


class TestMemCache:
    def test_mem_cache_get_expires_and_deletes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from web.services import mem_cache

        store: dict[str, tuple[float, object]] = {}
        mem_cache.mem_cache_set(store, "k", "v", ttl_seconds=1.0)

        # Not expired yet
        monkeypatch.setattr(time, "monotonic", lambda: store["k"][0] - 0.1)
        assert mem_cache.mem_cache_get(store, "k") == "v"

        # Expired -> returns None and deletes key
        monkeypatch.setattr(time, "monotonic", lambda: store["k"][0] + 0.1)
        assert mem_cache.mem_cache_get(store, "k") is None
        assert "k" not in store


class TestCorrelation:
    def test_correlation_counts_builds_and_service_events_last_hour(self) -> None:
        from web.services.correlation import correlation_last_hour

        now = datetime.now(tz=timezone.utc)
        snap = CISnapshot(
            builds=[
                BuildRecord(
                    source="jenkins",
                    job_name="a",
                    build_number=1,
                    status=BuildStatus.SUCCESS,
                    started_at=now - timedelta(minutes=30),
                ),
                BuildRecord(
                    source="jenkins",
                    job_name="a",
                    build_number=2,
                    status=BuildStatus.SUCCESS,
                    started_at=now - timedelta(hours=2),
                ),
            ]
        )

        def load_events(limit: int):
            assert limit == 500
            return [
                {"ts": (now - timedelta(minutes=10)).isoformat(), "kind": "svc_http_down"},
                {"ts": (now - timedelta(minutes=20)).isoformat(), "kind": "svc_docker_up"},
                {"ts": (now - timedelta(hours=3)).isoformat(), "kind": "svc_http_down"},
                {"ts": (now - timedelta(minutes=5)).isoformat(), "kind": "build_failure"},
                {"ts": "bad-ts", "kind": "svc_http_down"},
            ]

        out = correlation_last_hour(load_snapshot=lambda: snap, load_events=load_events, events_limit=500)
        assert out["pipelines_started_last_hour"] == 1
        assert out["service_events_last_hour"] == 2
