"""Tests for configured integration services and service monitor collect."""

from __future__ import annotations

from unittest.mock import MagicMock

from web.services.configured_services import (
    list_configured_services,
    merge_service_sources,
    service_exists,
)
from web.services.log_intelligence.service_keys import make_service_key
from web.services.log_intel_endpoints import api_create_model, api_list_candidates


def test_list_configured_services_includes_host_based_db():
    cfg = {
        "service_monitors": {
            "enabled": True,
            "instances": [
                {
                    "type": "redis",
                    "name": "prod-redis",
                    "enabled": True,
                    "host": "10.0.0.5",
                    "port": 6379,
                },
                {
                    "type": "zabbix",
                    "name": "zbx",
                    "enabled": True,
                    "url": "https://zabbix.example.com",
                },
                {
                    "type": "kafka",
                    "name": "empty-kafka",
                    "enabled": True,
                },
            ],
        },
        "docker_monitor": {
            "enabled": True,
            "http_checks": [{"name": "api", "url": "https://example.com/health"}],
        },
    }
    items = list_configured_services(cfg)
    kinds = {i["kind"] for i in items}
    assert "redis" in kinds
    assert "zabbix" in kinds
    assert "http" in kinds
    assert "kafka" not in kinds
    redis = next(i for i in items if i["kind"] == "redis")
    assert redis["name"] == "prod-redis"
    assert redis["source_instance"] == "prod-redis"


def test_merge_service_sources_prefers_snapshot():
    cfg_row = {
        "name": "prod-redis",
        "kind": "redis",
        "status": "unknown",
        "source_instance": "prod-redis",
    }
    snap_row = {
        "name": "prod-redis",
        "kind": "redis",
        "status": "up",
        "source_instance": "prod-redis",
    }
    merged = merge_service_sources([snap_row], [cfg_row])
    assert len(merged) == 1
    assert merged[0]["status"] == "up"


def test_service_monitors_collect_includes_host_instances():
    from web.services.collect_sync import service_monitors_collect as smc

    source = smc.__file__
    assert "_instance_configured(inst)" in open(source, encoding="utf-8").read()
    assert 'inst.get("url")' not in open(source, encoding="utf-8").read().split("instances = [")[1].split("]")[0]


def test_api_list_candidates_from_config_without_snapshot(tmp_path, monkeypatch):
    from web import db

    db.init_db(tmp_path)
    cfg = {
        "service_monitors": {
            "enabled": True,
            "instances": [
                {"type": "postgres", "name": "pg-main", "enabled": True, "host": "db.local", "port": 5432},
            ],
        },
    }
    empty_snap = MagicMock(services=[])

    out = api_list_candidates(
        load_snapshot=lambda: empty_snap,
        load_cfg=lambda: cfg,
    )
    assert out["ok"] is True
    assert len(out["items"]) == 1
    assert out["items"][0]["kind"] == "postgres"
    assert out["items"][0]["name"] == "pg-main"


def test_api_create_model_accepts_configured_integration(tmp_path, monkeypatch):
    from web import db
    from web.services.log_intelligence.store import LogIntelStore

    db.init_db(tmp_path)
    store = LogIntelStore()
    store.load_persisted()

    cfg = {
        "service_monitors": {
            "enabled": True,
            "instances": [
                {"type": "kafka", "name": "bus", "enabled": True, "host": "kafka.local", "port": 9092},
            ],
        },
    }
    key = make_service_key(kind="kafka", name="bus", source_instance="bus")
    empty_snap = MagicMock(services=[])

    out = api_create_model(
        body={"service_key": key, "display_name": "Kafka bus"},
        load_snapshot=lambda: empty_snap,
        load_cfg=lambda: cfg,
    )
    assert out["ok"] is True
    assert out["item"]["display_name"] == "Kafka bus"
