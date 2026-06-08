from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from models.models import CISnapshot


def test_warm_runtime_snapshot_from_db_primes_cache_and_last_collected(tmp_path: Path) -> None:
    from web.core.snapshot_cache import peek_snapshot_cache, invalidate_snapshot_cache
    from web.db import init_db, set_latest_snapshot_json
    from web.services import snapshot_boot

    init_db(tmp_path)
    collected = datetime(2026, 6, 7, 12, 0, 0, tzinfo=timezone.utc)
    snap = CISnapshot(
        collected_at=collected,
        builds=[],
        tests=[],
        services=[],
    )
    set_latest_snapshot_json(snap.model_dump_json())
    invalidate_snapshot_cache()

    state: dict = {}
    out = snapshot_boot.warm_runtime_snapshot_from_db(collect_state=state, logger=None)
    assert out is not None
    assert peek_snapshot_cache() is not None
    assert state.get("last_collected_at")
    assert snapshot_boot.get_persisted_baseline_cached() is not None


def test_patch_collect_publish_falls_back_to_db_baseline(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    from web.core.snapshot_cache import invalidate_snapshot_cache
    from web.db import init_db, set_latest_snapshot_json
    from web.services import snapshot_boot
    from web.services.snapshot_store import _patch_snapshot_for_collect_publish
    from models.models import BuildRecord, TestRecord

    init_db(tmp_path)
    prev = CISnapshot(
        builds=[BuildRecord(source="jenkins", job_name="j", build_number=1, status="success")],
        tests=[TestRecord(source="jenkins_allure", suite="s", test_name="t", status="failed")],
        services=[],
    )
    set_latest_snapshot_json(prev.model_dump_json())
    invalidate_snapshot_cache()
    snapshot_boot.prime_persisted_baseline_cache(prev)

    cur = CISnapshot(builds=[], tests=[], services=[])
    patched = _patch_snapshot_for_collect_publish(cur, {"is_collecting": True})
    assert len(patched.builds) == 1
    assert len(patched.tests) == 1
