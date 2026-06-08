"""Tests for external service monitor adapters."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from service_monitors.alertmanager import collect_alertmanager
from service_monitors.http_json import collect_http_json
from service_monitors.prometheus import collect_prometheus
from service_monitors.runner import collect_service_monitors, probe_service_monitor, service_monitors_enabled
from service_monitors.zabbix import collect_zabbix


def test_service_monitors_enabled_requires_instance():
    assert service_monitors_enabled({"service_monitors": {"enabled": True, "instances": []}}) is False
    assert (
        service_monitors_enabled(
            {
                "service_monitors": {
                    "enabled": True,
                    "instances": [{"type": "prometheus", "enabled": True, "url": "http://p:9090"}],
                }
            }
        )
        is True
    )


@patch("service_monitors.prometheus.request_json")
def test_collect_prometheus_alerts(mock_req):
    mock_req.return_value = {
        "status": "success",
        "data": {
            "alerts": [
                {
                    "labels": {"alertname": "DiskFull", "instance": "srv1"},
                    "state": "firing",
                    "annotations": {"summary": "disk 95%"},
                }
            ]
        },
    }
    items = collect_prometheus({"name": "prom", "url": "http://prom:9090"}, timeout=5)
    assert len(items) == 1
    assert items[0].kind == "prometheus"
    assert items[0].status == "down"
    assert "DiskFull" in items[0].name


@patch("service_monitors.alertmanager.request_json")
def test_collect_alertmanager(mock_req):
    mock_req.return_value = [
        {
            "labels": {"alertname": "HighCPU"},
            "status": {"state": "active"},
            "annotations": {"summary": "cpu high"},
        }
    ]
    items = collect_alertmanager({"name": "am", "url": "http://am:9093"}, timeout=5)
    assert items[0].kind == "alertmanager"
    assert items[0].status == "down"


@patch("service_monitors.zabbix._rpc")
def test_collect_zabbix_problems(mock_rpc):
    mock_rpc.return_value = {
        "result": [
            {"name": "CPU high", "severity": "4", "acknowledged": "0"},
            {"name": "Disk low", "severity": "2", "acknowledged": "1"},
        ]
    }
    items = collect_zabbix(
        {"name": "zbx", "url": "http://zabbix", "token": "t", "mode": "problems"},
        timeout=5,
    )
    assert len(items) == 2
    assert items[0].status == "down"
    assert items[1].status == "degraded"


@patch("service_monitors.http_json.request_json")
def test_collect_http_json_generic(mock_req):
    mock_req.return_value = {
        "data": [
            {"name": "api", "status": "ok", "detail": "fine"},
            {"name": "db", "status": "fail", "detail": "timeout"},
        ]
    }
    items = collect_http_json(
        {
            "name": "custom",
            "url": "http://monitor/api",
            "items_path": "data",
            "name_field": "name",
            "status_field": "status",
            "detail_field": "detail",
            "status_map": {"ok": "up", "fail": "down"},
        },
        timeout=5,
    )
    assert items[0].status == "up"
    assert items[1].status == "down"


@patch("service_monitors.runner.collect_instance")
def test_collect_service_monitors_merges_instances(mock_collect):
    from models.models import ServiceStatus

    mock_collect.side_effect = lambda inst, timeout: [
        ServiceStatus(name=str(inst.get("name")), kind=str(inst.get("type")), status="up")
    ]

    cfg = {
        "service_monitors": {
            "enabled": True,
            "instances": [
                {"type": "prometheus", "name": "p1", "enabled": True, "url": "http://a"},
                {"type": "zabbix", "name": "z1", "enabled": True, "url": "http://b"},
            ],
        }
    }
    out = collect_service_monitors(cfg)
    assert len(out) == 2
    assert {x.name for x in out} == {"p1", "z1"}


@patch("service_monitors.runner._TESTERS")
def test_probe_service_monitor_dispatch(mock_testers):
    mock_testers.get.return_value = lambda inst: {"ok": True, "message": "ok"}
    from service_monitors.runner import probe_service_monitor

    out = probe_service_monitor({"type": "prometheus", "url": "http://p"})
    assert out["ok"] is True
