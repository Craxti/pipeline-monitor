from __future__ import annotations

from web.services.trends_kpi_service import TrendsKPIService


def test_trends_kpi_service_delegates_filters_and_days() -> None:
    got: dict = {}

    def _trends_compute(days: int) -> list:
        got["days"] = days
        return [{"date": "2026-04-01", "builds_failed": 1, "job_failures": {}, "job_totals": {}}]

    def _event_feed_load(limit: int) -> list[dict]:
        got["limit"] = limit
        return []

    svc = TrendsKPIService(trends_compute=_trends_compute, event_feed_load=_event_feed_load)
    out = svc.history_summary(days=14, source_filter="jenkins", instance_filter="jenkins|main")

    assert got["days"] == 14
    assert got["limit"] == 2000
    assert out["scope_source"] == "jenkins"
    assert out["scope_instance"] == "jenkins|main"
