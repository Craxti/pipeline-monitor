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


def test_trends_history_summary_applies_source_and_instance_filters() -> None:
    history = [
        {
            "date": "2026-04-01",
            "builds_failed": 3,
            "builds_by_source": {"jenkins": {"failed": 2}, "gitlab": {"failed": 1}},
            "builds_by_instance": {"jenkins|main": {"failed": 2}, "gitlab|prod": {"failed": 1}},
            "job_failures_by_source": {"jenkins": {"job-a": 2}, "gitlab": {"job-b": 1}},
            "job_totals_by_source": {"jenkins": {"job-a": 4}, "gitlab": {"job-b": 2}},
            "job_failures_by_instance": {"jenkins|main": {"job-a": 2}, "gitlab|prod": {"job-b": 1}},
            "job_totals_by_instance": {"jenkins|main": {"job-a": 4}, "gitlab|prod": {"job-b": 2}},
        }
    ]
    events = [
        {
            "kind": "build_fail",
            "title": "Job FAILED: job-a",
            "job_name": "job-a",
            "source": "jenkins",
            "source_instance": "main",
            "ts": "2026-04-01T10:00:00+00:00",
        },
        {
            "kind": "build_recovered",
            "title": "Job RECOVERED: job-a",
            "job_name": "job-a",
            "source": "jenkins",
            "source_instance": "main",
            "ts": "2026-04-01T10:30:00+00:00",
        },
        {
            "kind": "build_fail",
            "title": "Job FAILED: job-b",
            "job_name": "job-b",
            "source": "gitlab",
            "source_instance": "prod",
            "ts": "2026-04-01T11:00:00+00:00",
        },
    ]

    out_src = trends_uptime.trends_history_summary(
        7,
        trends_compute=lambda _d: history,
        event_feed_load=lambda _lim: events,
        source_filter="jenkins",
    )
    assert out_src["crash_frequency_per_day"] == 2.0
    assert out_src["most_problematic_jobs"][0]["job_name"] == "job-a"
    assert out_src["recovery_samples"] == 1

    out_inst = trends_uptime.trends_history_summary(
        7,
        trends_compute=lambda _d: history,
        event_feed_load=lambda _lim: events,
        source_filter="jenkins",
        instance_filter="jenkins|main",
    )
    assert out_inst["crash_frequency_per_day"] == 2.0
    assert out_inst["avg_recovery_minutes"] == 30.0


def test_trends_history_summary_fallback_for_legacy_rows_without_job_slices() -> None:
    history = [
        {
            "date": "2026-04-01",
            "builds_failed": 2,
            "builds_by_source": {"jenkins": {"failed": 2}},
            "builds_by_instance": {"jenkins|main": {"failed": 2}},
            # legacy row: only global job maps (no job_failures_by_instance/source)
            "job_failures": {"job-a": 2},
            "job_totals": {"job-a": 4},
        }
    ]
    out = trends_uptime.trends_history_summary(
        7,
        trends_compute=lambda _d: history,
        event_feed_load=lambda _lim: [],
        source_filter="jenkins",
        instance_filter="jenkins|main",
    )
    assert out["most_problematic_jobs"]
    assert out["most_problematic_jobs"][0]["job_name"] == "job-a"


def test_trends_history_summary_no_global_fallback_when_instance_slices_exist() -> None:
    history = [
        {
            "date": "2026-04-01",
            "builds_failed": 2,
            "job_failures": {"job-global": 9},
            "job_totals": {"job-global": 10},
            "job_failures_by_instance": {"jenkins|a": {"job-a": 2}, "jenkins|b": {"job-b": 1}},
            "job_totals_by_instance": {"jenkins|a": {"job-a": 4}, "jenkins|b": {"job-b": 5}},
        }
    ]
    out = trends_uptime.trends_history_summary(
        7,
        trends_compute=lambda _d: history,
        event_feed_load=lambda _lim: [],
        source_filter="jenkins",
        instance_filter="jenkins|a",
    )
    assert out["most_problematic_jobs"]
    assert out["most_problematic_jobs"][0]["job_name"] == "job-a"
    assert all(j["job_name"] != "job-global" for j in out["most_problematic_jobs"])
