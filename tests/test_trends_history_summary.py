from __future__ import annotations

from web.services import trends_uptime


def test_trends_history_summary_core_metrics() -> None:
    history = [
        {
            "date": "2026-04-01",
            "builds_failed": 2,
            "job_failures": {"job-a": 2, "job-b": 1},
            "job_totals": {"job-a": 4, "job-b": 10},
        },
        {
            "date": "2026-04-02",
            "builds_failed": 1,
            "job_failures": {"job-a": 1, "job-c": 1},
            "job_totals": {"job-a": 3, "job-c": 2},
        },
    ]
    events = [
        {"kind": "build_fail", "title": "Job FAILED: job-a", "ts": "2026-04-01T10:00:00+00:00"},
        {"kind": "build_recovered", "title": "Job RECOVERED: job-a", "ts": "2026-04-01T10:30:00+00:00"},
        {"kind": "build_fail", "title": "Job FAILED: job-b", "ts": "2026-04-02T11:00:00+00:00"},
        {"kind": "build_recovered", "title": "Job RECOVERED: job-b", "ts": "2026-04-02T11:45:00+00:00"},
    ]

    out = trends_uptime.trends_history_summary(
        30,
        trends_compute=lambda _d: history,
        event_feed_load=lambda _lim: events,
    )

    assert out["days_with_data"] == 2
    assert out["crash_frequency_per_day"] == 1.5
    assert out["recovery_samples"] == 2
    assert out["avg_recovery_minutes"] == 37.5
    assert out["most_problematic_jobs"][0]["job_name"] == "job-a"
    assert out["most_problematic_jobs"][0]["failed"] == 3


def test_trends_history_summary_handles_missing_recoveries() -> None:
    history = [{"date": "2026-04-01", "builds_failed": 0, "job_failures": {}, "job_totals": {}}]
    events = [{"kind": "build_fail", "title": "Job FAILED: job-a", "ts": "2026-04-01T10:00:00+00:00"}]

    out = trends_uptime.trends_history_summary(
        14,
        trends_compute=lambda _d: history,
        event_feed_load=lambda _lim: events,
    )
    assert out["avg_recovery_minutes"] is None
    assert out["recovery_samples"] == 0
