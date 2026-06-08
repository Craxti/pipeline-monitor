"""Tests for log intelligence pipeline."""

from __future__ import annotations

import tempfile

import pytest

from web.services.log_intelligence.container_model import ContainerLogModel
from web.services.log_intelligence.service_keys import make_service_key
from web.services.log_intelligence.store import LogIntelStore
from web.services.log_intelligence.template_extractor import extract_template, template_id


@pytest.fixture
def tmp_db():
    with tempfile.TemporaryDirectory() as td:
        from web import db

        db.init_db(td)
        yield db


def test_extract_template_normalizes_numbers():
    line = "2024-01-02T10:00:00Z ERROR user 42 failed at 10.0.0.1 id=abc-123"
    tpl = extract_template(line)
    assert "<N>" in tpl
    assert "42" not in tpl
    assert "10.0.0.1" not in tpl


def test_extract_template_strips_bracket_timestamp():
    line = (
        "[2024-01-15 10:00:00,123] INFO Reading configuration from: "
        "/etc/kafka/zookeeper.properties (org.apache.zookeeper.server.quorum.QuorumPeerConfig)"
    )
    tpl = extract_template(line)
    assert not tpl.startswith("[")
    assert "<N>-<N>-<N>" not in tpl
    assert "Reading configuration from:" in tpl
    assert "QuorumPeerConfig" in tpl


def test_extract_template_strips_bracket_timestamp_after_normalization():
    tpl = extract_template("[2024-01-15 10:00:00,123] WARN slow query took 42 ms")
    assert tpl.startswith("WARN") or tpl.startswith("slow")
    assert "[<N>" not in tpl


def test_container_model_clustering_and_correlation():
    m = ContainerLogModel(container="app", docker_host="")
    text = "\n".join(
        [
            "INFO Starting service",
            "INFO Connected to database",
            "ERROR Connection timeout ret=1",
            "INFO Starting service",
            "ERROR Connection timeout ret=2",
        ]
        * 8
    )
    n = m.ingest_text(text)
    assert n >= 40
    assert len(m.clusters) >= 2
    detail = m.detail_payload()
    assert detail["pipeline"]["clustering"]["status"] == "ready"
    assert len(detail["correlation"]["nodes"]) >= 1


def test_store_list_summaries(tmp_db):
    store = LogIntelStore()
    key = make_service_key(kind="docker", name="web", source_instance="local")
    store.create_registry_model(display_name="Web", service_key=key, enabled=True)
    store.ingest(name="web", kind="docker", source_instance="local", text="INFO ok\nWARN slow\n" * 25)
    items = store.list_summaries([{"name": "web", "kind": "docker", "status": "up", "source_instance": "local"}])
    assert len(items) == 1
    assert items[0]["container"] == "web"
    assert items[0]["key"] == key
    assert items[0]["clusters"] >= 1


def test_list_summaries_excludes_unregistered_snapshot_services(tmp_db):
    store = LogIntelStore()
    items = store.list_summaries([{"name": "db", "kind": "docker", "status": "up", "source_instance": "hostA"}])
    assert items == []


def test_container_model_storage_roundtrip():
    m = ContainerLogModel(container="app", docker_host="host1")
    m.ingest_text("INFO start\nERROR boom\nINFO start\n" * 12)
    blob = m.to_storage_dict()
    restored = ContainerLogModel.from_storage_dict(blob)
    assert restored.container == "app"
    assert restored.docker_host == "host1"
    assert restored.lines_ingested == m.lines_ingested
    assert len(restored.clusters) == len(m.clusters)
    assert restored.transitions == m.transitions


def test_store_watch_persist_roundtrip(tmp_path):
    from web import db

    db.init_db(tmp_path)
    store = LogIntelStore()
    key = make_service_key(kind="docker", name="api", source_instance="local")
    store.create_registry_model(display_name="API", service_key=key, enabled=True)
    store.ingest(name="api", kind="docker", source_instance="local", text="INFO ping\n" * 30)
    store.persist_all()
    store2 = LogIntelStore()
    store2.load_persisted()
    assert store2.is_enabled(key)
    model = store2.get(key)
    assert model is not None
    assert model.lines_ingested >= 30
