"""Tests for service analysis model registry."""

from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from web.services.log_intelligence.service_keys import make_service_key
from web.services.log_intelligence.store import LogIntelStore


@pytest.fixture
def tmp_db():
    with tempfile.TemporaryDirectory() as td:
        from web import db

        db.init_db(td)
        yield db


def test_create_and_list_registry_model(tmp_db):
    store = LogIntelStore()
    key = make_service_key(kind="http", name="api", source_instance="prod")
    entry = store.create_registry_model(display_name="API monitor", service_key=key, enabled=True)
    assert entry["id"]
    items = store.list_registry_summaries(None)
    assert len(items) == 1
    assert items[0]["display_name"] == "API monitor"
    assert items[0]["enabled"] is True


def test_ingest_only_when_enabled(tmp_db):
    store = LogIntelStore()
    key = make_service_key(kind="docker", name="web", source_instance="")
    store.create_registry_model(display_name="Web", service_key=key, enabled=False)
    n = store.ingest(name="web", kind="docker", source_instance="", text="[ERROR] fail\n")
    assert n == 0
    store.update_registry_model(int(store.list_registry_summaries(None)[0]["id"]), enabled=True)
    n = store.ingest(name="web", kind="docker", source_instance="", text="[ERROR] fail\n")
    assert n >= 1


def test_delete_registry_removes_model(tmp_db):
    store = LogIntelStore()
    key = make_service_key(kind="http", name="x", source_instance="")
    entry = store.create_registry_model(display_name="X", service_key=key, enabled=True)
    store.ingest(name="x", kind="http", source_instance="", text="[INFO] ok\n")
    mid = int(entry["id"])
    deleted = store.delete_registry_model(mid)
    assert deleted is not None
    assert store.list_registry_summaries(None) == []
    assert store.get(key) is None


@patch("web.db.insert_service_analysis_model")
def test_migrate_legacy_watched(mock_insert):
    from web.services.log_intelligence import registry

    mock_insert.return_value = 1
    with patch("web.db.count_service_analysis_models", return_value=0):
        with patch("web.db.get_service_analysis_model_by_key", return_value=None):
            registry.migrate_legacy_watched({make_service_key(kind="docker", name="c1", source_instance="local")})
    assert mock_insert.called
