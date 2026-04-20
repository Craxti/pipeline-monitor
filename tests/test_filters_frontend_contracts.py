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
    assert "_scopeStore()" in js


def test_trends_reset_filters_contract() -> None:
    js = _read("web/static/dashboard.trends.js")
    assert "function resetTrendsFilters()" in js
    assert "window.resetTrendsFilters = resetTrendsFilters;" in js
    assert "TrendsFiltersAdapter" in js


def test_trends_scope_module_is_loaded_before_trends_script() -> None:
    html = _read("web/templates/index.html")
    adapter_idx = html.find("/static/dashboard.trends.filters.adapter.js")
    scope_idx = html.find("/static/dashboard.trends.scope.js")
    trends_idx = html.find("/static/dashboard.trends.js")
    assert adapter_idx != -1 and scope_idx != -1 and trends_idx != -1
    assert adapter_idx < scope_idx
    assert scope_idx < trends_idx


def test_trends_empty_reason_contract_present() -> None:
    js = _read("web/static/dashboard.trends.js")
    assert "dash.trend_kpi_problem_jobs_why_empty" in js


def test_chat_prompt_is_not_hardcoded_in_helpers_ui() -> None:
    js = _read("web/static/dashboard.helpers.ui.js")
    assert "window.chatPrompt('runbook_focus_tests'" in js


def test_trends_global_scope_toggle_contract() -> None:
    html = _read("web/templates/index.html")
    js = _read("web/static/dashboard.trends.js")
    adapter = _read("web/static/dashboard.trends.filters.adapter.js")
    assert 'id="trends-scope-global"' in html
    assert "_syncTrendsScopeToGlobalIfEnabled" in js
    assert "applyScopeToGlobalFilters" in adapter
