from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).parent.parent


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def test_populate_sources_reapplies_url_filters_after_dropdown_rebuild() -> None:
    sources_js = _read("web/static/dashboard.sources.js")
    init_js = _read("web/static/dashboard.init.js")
    assert "_readURLFilters()" in sources_js
    assert "_populateSourcesPromise" in sources_js
    assert "_pickBuildSourceValue" in sources_js
    assert "abortFetchKey(k)" in init_js
    assert "populateSourcesAndInstances().then(() => {" in init_js
    assert "_initObserver('builds', loadBuilds)" in init_js


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
    assert 'data-tab="trends"' not in html
    assert 'id="tab-panel-trends"' not in html
    assert "/static/dashboard.trends.js" not in html


def test_chat_prompt_is_not_hardcoded_in_helpers_ui() -> None:
    js = _read("web/static/dashboard.helpers.ui.js")
    assert "window.chatPrompt('runbook_focus_tests'" in js


def test_services_tab_required_panels_contract() -> None:
    html = _read("web/templates/index.html")
    assert 'id="tab-panel-services"' in html
    assert 'id="panel-svcs"' in html
    assert 'id="ic-cards"' in html
    assert 'id="tab-panel-incidents"' in html
    assert "/static/dashboard.incidents.js" in html
    assert 'id="panel-flaky"' not in html
