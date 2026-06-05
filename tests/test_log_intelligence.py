"""Tests for log intelligence pipeline."""

from __future__ import annotations

from web.services.log_intelligence.container_model import ContainerLogModel
from web.services.log_intelligence.store import LogIntelStore
from web.services.log_intelligence.template_extractor import extract_template, template_id


def test_extract_template_normalizes_numbers():
    line = "2024-01-02T10:00:00Z ERROR user 42 failed at 10.0.0.1 id=abc-123"
    tpl = extract_template(line)
    assert "<N>" in tpl
    assert "42" not in tpl
    assert "10.0.0.1" not in tpl


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


def test_store_list_summaries():
    store = LogIntelStore()
    store.ingest(container="web", docker_host="local", text="INFO ok\nWARN slow\n" * 25)
    items = store.list_summaries([{"name": "web", "kind": "docker", "status": "up", "source_instance": "local"}])
    assert len(items) == 1
    assert items[0]["container"] == "web"
    assert items[0]["key"] == "local::web"
    assert items[0]["clusters"] >= 1


def test_list_summaries_includes_snapshot_only_key():
    store = LogIntelStore()
    items = store.list_summaries([{"name": "db", "kind": "docker", "status": "up", "source_instance": "hostA"}])
    assert len(items) == 1
    assert items[0]["key"] == "hostA::db"
    assert items[0]["events"] == 0


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


def test_store_watch_persist_roundtrip(tmp_path, monkeypatch):
    from web import db

    db.init_db(tmp_path)
    store = LogIntelStore()
    store.ingest(container="api", docker_host="local", text="INFO ping\n" * 30)
    key = "local::api"
    store.set_watched(key, True)
    store2 = LogIntelStore()
    store2.load_persisted()
    assert store2.is_watched(key)
    model = store2.get(key)
    assert model is not None
    assert model.lines_ingested >= 30
