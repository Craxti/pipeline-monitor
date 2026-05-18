from web.services import collect_interval_policy as cip


def test_effective_collect_interval_base_only() -> None:
    w = {"collect_interval_seconds": 300}
    assert cip.effective_collect_interval_seconds(w, dashboard_live_fast_collect=False) == 300


def test_effective_collect_interval_live_shortens() -> None:
    w = {"collect_interval_seconds": 300, "live_collect_interval_seconds": 60}
    assert cip.effective_collect_interval_seconds(w, dashboard_live_fast_collect=True) == 60


def test_effective_collect_interval_live_capped_by_base() -> None:
    w = {"collect_interval_seconds": 40, "live_collect_interval_seconds": 999}
    assert cip.effective_collect_interval_seconds(w, dashboard_live_fast_collect=True) == 40


def test_clamp_poll() -> None:
    assert cip.clamp_live_dashboard_poll_seconds(3) == 8
    assert cip.clamp_live_dashboard_poll_seconds(25) == 25
    assert cip.clamp_live_dashboard_poll_seconds(999) == 120
