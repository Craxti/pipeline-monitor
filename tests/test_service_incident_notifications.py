"""Tests for service incident notification wiring."""

from __future__ import annotations

from unittest.mock import patch

from web.services.log_intelligence.container_model import AnomalyRecord, ContainerLogModel
from web.services.log_intelligence import incident_store
from web.services.log_intelligence import notifier
from web.services.notification_state import NotificationState
from web.services import notify_runtime


def test_append_notify_entries_populates_state():
    state = NotificationState(notify_max=10)
    fed: list[dict] = []

    def _feed(batch):
        fed.extend(batch)

    notify_runtime.append_notify_entries(
        state,
        [{"id": 1, "ts": "t", "kind": "service_incident", "level": "warn", "title": "X", "detail": "d"}],
        feed_append=_feed,
    )
    assert len(state.notifications) == 1
    assert state.notifications[0]["title"] == "X"
    assert len(fed) == 1


@patch("web.db.insert_service_incident")
@patch("web.db.find_open_service_incident")
def test_emit_anomaly_notifies_only_new_incident(mock_find, mock_insert):
    mock_find.return_value = None
    mock_insert.return_value = 99
    model = ContainerLogModel(container="api", docker_host="local", service_kind="http")
    anom = AnomalyRecord(
        id="a1",
        ts="2026-01-01T00:00:00+00:00",
        kind="first_error",
        severity="critical",
        title="Error spike",
        detail="timeout",
        template_id="t1",
    )
    fed: list[dict] = []

    seq = notifier.emit_anomaly_notifications(
        anomalies=[anom],
        model=model,
        notify_append=lambda batch: fed.extend(batch),
        notify_id_seq=5,
    )
    assert seq == 6
    assert len(fed) == 1
    assert fed[0]["kind"] == "service_incident"
    assert fed[0]["id"] == 6


@patch("web.db.update_service_incident")
@patch("web.db.find_open_service_incident")
def test_emit_anomaly_skips_when_incident_already_open(mock_find, mock_update):
    mock_find.return_value = {"id": 7, "detail": "was open"}
    model = ContainerLogModel(container="api", docker_host="local", service_kind="http")
    anom = AnomalyRecord(
        id="a1",
        ts="2026-01-01T00:00:00+00:00",
        kind="first_error",
        severity="critical",
        title="Error spike",
        detail="timeout",
        template_id="t1",
    )
    fed: list[dict] = []

    seq = notifier.emit_anomaly_notifications(
        anomalies=[anom],
        model=model,
        notify_append=lambda batch: fed.extend(batch),
        notify_id_seq=5,
    )
    assert seq == 5
    assert fed == []


def test_emit_incident_resolved_notification():
    fed: list[dict] = []
    seq = notifier.emit_incident_resolved(
        incident_ids=[12],
        service_name="api",
        service_kind="http",
        notify_append=lambda batch: fed.extend(batch),
        notify_id_seq=3,
    )
    assert seq == 4
    assert len(fed) == 1
    assert fed[0]["kind"] == "service_incident_resolved"
    assert fed[0]["level"] == "ok"
