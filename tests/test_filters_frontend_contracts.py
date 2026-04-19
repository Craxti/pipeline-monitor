from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).parent.parent


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def test_url_filter_params_include_test_and_service_status() -> None:
    js = _read("web/static/dashboard.filters.js")
    assert "{ id:'f-tstatus',key:'tstatus' }" in js
    assert "{ id:'f-svstatus', key:'svstatus' }" in js


def test_clear_filters_persist_to_local_storage_contract() -> None:
    tests_js = _read("web/static/dashboard.tests.js")
    svcs_js = _read("web/static/dashboard.services.js")
    failures_js = _read("web/static/dashboard.failures.js")

    assert "_persistFiltersFromForm()" in tests_js
    assert "_persistFiltersFromForm()" in svcs_js
    assert "_persistFiltersFromForm()" in failures_js


def test_trends_kpi_uses_active_instance_contract() -> None:
    js = _read("web/static/dashboard.trends.js")
    assert "function _activeTrendsInstance()" in js
    assert "trends-inst-top" in js
    assert "trends-inst-builds" in js
    assert "trends-inst-tests" in js
