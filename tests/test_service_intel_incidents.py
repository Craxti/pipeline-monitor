"""Tests for service analysis keys and incidents."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from web.services.log_intelligence.service_keys import make_service_key, parse_service_key


def test_make_and_parse_service_key():
    key = make_service_key(kind="zabbix", name="CPU high", source_instance="prod-zbx")
    assert key == "prod-zbx::zabbix::CPU high"
    host, kind, name = parse_service_key(key)
    assert host == "prod-zbx"
    assert kind == "zabbix"
    assert name == "CPU high"


def test_parse_legacy_docker_key():
    host, kind, name = parse_service_key("local::my-container")
    assert kind == "docker"
    assert name == "my-container"


@patch("web.db.insert_service_incident")
@patch("web.db.find_open_service_incident")
def test_open_incident_from_anomaly(
    mock_find,
    mock_insert,
):
    from web.services.log_intelligence.container_model import AnomalyRecord, ContainerLogModel
    from web.services.log_intelligence import incident_store

    mock_find.return_value = None
    mock_insert.return_value = 42
    model = ContainerLogModel(container="api", docker_host="local", service_kind="http")
    model.ingest_text("[ERROR] timeout\n[ERROR] timeout again\n", source="http")
    anom = AnomalyRecord(
        id="a1",
        ts="2026-01-01T00:00:00+00:00",
        kind="first_error",
        severity="critical",
        title="Error",
        detail="timeout",
        template_id="t1",
    )
    row = incident_store.open_incident_from_anomaly(model=model, anomaly=anom)
    assert row is not None
    assert row["id"] == 42
    assert mock_insert.called


@patch("web.db.update_service_incident")
@patch("web.db.find_open_service_incident")
def test_resolve_incident(mock_find, mock_update):
    from web.services.log_intelligence import incident_store
    from web.services.log_intelligence.service_keys import make_service_key

    key = make_service_key(kind="http", name="api", source_instance="")
    mock_find.return_value = {"id": 7, "detail": "was down"}
    ids = incident_store.resolve_incidents_for_service(key)
    assert ids == [7]
    mock_update.assert_called_once()
