from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).parent.parent


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def test_populate_sources_reapplies_url_filters_after_dropdown_rebuild() -> None:
    sources_js = _read("web/static/dashboard.sources.js")
    init_js = _read("web/static/dashboard.init.js")
    panel_js = _read("web/static/dashboard.panel-state.js")
    assert "_readURLFilters()" in sources_js
    assert "_populateSourcesPromise" in sources_js
    assert "_pickBuildSourceValue" in sources_js
    assert "abortFetchKey(k)" in init_js
    assert "populateSourcesAndInstances().then(() => {" in init_js
    assert "_initAllTableObservers()" in init_js
    assert "loadBuilds();" in init_js
    assert "builds: ['builds', loadBuilds]" in panel_js
    assert "_initObserver(key, loadFn)" in panel_js


def test_url_filter_params_include_test_and_service_status() -> None:
    js = _read("web/static/dashboard.filters.js")
    assert "{ id:'f-tstatus',key:'tstatus' }" in js
    assert "{ id:'f-tsource', key:'tsource' }" in js
    assert "{ id:'f-tinstance', key:'tinstance' }" in js
    assert "{ id:'f-fsource', key:'fsource' }" in js
    assert "{ id:'f-finstance', key:'finstance' }" in js
    assert "{ id:'f-svstatus', key:'svstatus' }" in js
    assert "_clearTimeFilterBtns" in js


def test_test_panels_use_ci_source_and_instance_filters_contract() -> None:
    html = _read("web/templates/index.html")
    sources_js = _read("web/static/dashboard.sources.js")
    tests_js = _read("web/static/dashboard.tests.js")
    failures_js = _read("web/static/dashboard.failures.js")
    assert 'id="f-tsource"' in html
    assert 'id="f-tinstance"' in html
    assert 'id="f-fsource"' in html
    assert 'id="f-finstance"' in html
    assert 'value="jenkins"' in html
    assert 'value="github"' in html
    assert 'id="tsrc-real"' not in html
    assert "function _onTestSourceFilterChange(" in sources_js
    assert "function _renderAllTestInstanceOptions(" in sources_js
    assert "&instance=${encodeURIComponent(instance)}" in tests_js
    assert "&instance=${encodeURIComponent(instance)}" in failures_js
    assert "openTestErrorModal(" in failures_js


def test_global_search_ui_in_dashboard_html() -> None:
    html = _read("web/templates/index.html")
    assert 'id="global-search"' in html
    assert 'id="global-search-wrap"' in html


def test_tokens_css_is_first_stylesheet_import() -> None:
    css = _read("web/static/app.css")
    assert '@import "tokens.css' in css
    assert css.index("tokens.css") < css.index("dashboard.css")


def test_pages_unified_css_is_imported() -> None:
    css = _read("web/static/app.css")
    assert "dashboard.pages-unified.css" in css


def test_top_failures_table_is_scrollable_contract() -> None:
    css = _read("web/static/dashboard.pages-unified.css")
    assert "#tab-panel-test-failures #panel-failures .tbl-wrap" in css
    assert "overflow: auto" in css


def test_top_failures_loads_all_pages_in_one_session_contract() -> None:
    js = _read("web/static/dashboard.failures.js")
    assert "TOP_FAILURES_AGG_LIMIT" in js
    assert "while (myGen === _failuresLoadGen && !s.done)" in js
    assert "requestAnimationFrame(() => { loadFailures(); })" not in js


def test_trends_more_filters_button_in_html() -> None:
    html = _read("web/templates/index.html")
    assert 'id="btn-trends-more-filters"' in html
    assert 'class="trends-filters-advanced"' in html
    assert "toggleTrendsAdvancedFilters" in _read("web/static/dashboard.trends.js")


def test_utilities_css_is_imported() -> None:
    css = _read("web/static/app.css")
    assert "dashboard.utilities.css" in css


def test_controls_modern_css_is_imported() -> None:
    css = _read("web/static/app.css")
    assert "dashboard.controls-modern.css" in css


def test_modern_select_dropdown_script_in_html() -> None:
    html = _read("web/templates/index.html")
    js = _read("web/static/dashboard.select-modern.js")
    assert "dashboard.select-modern.js" in html
    assert "initModernSelects" in js
    assert "select-modern-menu" in _read("web/static/dashboard.controls-modern.css")


def test_trends_ui_css_is_imported() -> None:
    css = _read("web/static/app.css")
    assert "dashboard.trends-ui.css" in css


def test_trends_keep_cache_during_collect_contract() -> None:
    js = _read("web/static/dashboard.trends.js")
    assert "shouldSkipTrendsReloadDuringCollect" in js
    assert "_trendsCollectGraceActive" in js
    assert "_setTrendsLoading" in js
    assert 'id="trends-loading"' in _read("web/templates/index.html")


def test_test_runs_flat_one_row_per_run_contract() -> None:
    js = _read("web/static/dashboard.tests.js")
    assert "function _renderTestRunsTable(" in js
    assert "function _sortTestsRows(" in js
    assert "test-run-row" in js
    assert "_renderTestRunsTable(rows)" in js
    assert "function _appendRunBuildLink(" in js
    assert "function _openBuildFromTestRun(" in js
    assert "while (myGen === _testsLoadGen && !s.done)" in js


def test_time_filter_changes_force_hard_table_reset_contract() -> None:
    tests_js = _read("web/static/dashboard.tests.js")
    failures_js = _read("web/static/dashboard.failures.js")
    builds_js = _read("web/static/dashboard.builds.js")
    actions_js = _read("web/static/dashboard.actions.js")

    assert "function resetTests() {" in tests_js
    assert "resetTestsSoft(false, true)" in tests_js
    assert "if (force || !soft) _lastTestsPageSig = ''" in tests_js
    assert "`${_testsHours}\\x1e`" in tests_js
    assert "resetFailures(false, true)" in tests_js

    assert "function resetFailures(soft=false, force=false)" in failures_js
    assert "if (force || !soft) _lastFailuresPageSig = ''" in failures_js
    assert "`${_failuresDays}\\x1e`" in failures_js

    assert "resetBuilds(false, true)" in actions_js
    assert "`${_buildsHours}\\x1e`" in builds_js


def test_test_runs_keep_table_during_collect_contract() -> None:
    js = _read("web/static/dashboard.tests.js")
    collect_js = _read("web/static/dashboard.collect-panel.js")
    assert "keepTableOnTransientEmpty(tbody, rows, s, 'tests')" in js
    assert "keepTableOnTransientApiError(tbody, res, s, 'tests')" in js
    assert "cacheStaleTableHtml('tests', tbody)" in js
    assert "shouldSkipTableReloadDuringCollect('tests', tbody)" in js
    assert "resetTestsSoft(true)" not in collect_js
    assert "resetBuilds(" not in collect_js
    assert "resetFailures(true)" not in collect_js
    assert "resetServices(" not in collect_js
    assert "resetBuilds(true)" not in collect_js
    assert "resetFailures(true)" not in collect_js


def test_top_failures_keep_table_during_collect_contract() -> None:
    js = _read("web/static/dashboard.failures.js")
    collect_js = _read("web/static/dashboard.collect-panel.js")
    assert "keepTableOnTransientEmpty(tbody, rows, s, 'failures')" in js
    assert "keepTableOnTransientApiError(tbody, res, s, 'failures')" in js
    assert "cacheStaleTableHtml('failures', tbody)" in js
    assert "shouldSkipTableReloadDuringCollect('failures', tbody)" in js
    assert "resetFailures(true)" not in collect_js
    assert "refreshLiveTestsPanelsDuringCollect" in collect_js
    assert "snapshot_partial" in _read("web/static/dashboard.helpers.ui.js")


def test_live_sse_partial_refresh_contract() -> None:
    collect_js = _read("web/static/dashboard.collect-panel.js")
    ui_js = _read("web/static/dashboard.helpers.ui.js")
    assert "refreshLivePanelsDuringCollect" in collect_js
    assert "refreshLiveTestsPanelsDuringCollect" in collect_js
    assert "snapshot_partial" in ui_js
    assert "collectIncrementalPerPage" in collect_js
    assert "isCollectIncrementalRefresh" in collect_js
    assert "_collectIncrementalRefresh" in collect_js
    assert "loadBuilds" in collect_js
    assert "loadFailures" in collect_js
    assert "loadTests" in collect_js
    assert "loadServices" in collect_js
    assert "renderIncidentCenter" in collect_js
    assert "notifyCollectCountsChanged" in collect_js
    assert "for (const step of steps)" in collect_js
    assert "buildsCountDelta" in collect_js
    assert "loadSummary" in collect_js
    assert "_lastIncrementalAppliedCounts" in collect_js
    assert "_lastPartialLiveCounts" not in collect_js
    assert "prev.phase" in collect_js
    assert "const needBuilds = true" not in collect_js
    assert "_incrTabNeedsBuilds" in collect_js
    assert "_collectIncrementalPending" in collect_js
    assert "_sseReconnectTimer" in ui_js
    ls = _read("web/static/dashboard.load-summary.js")
    assert "summary.status.live" in ls
    assert "renderOverviewPreview" in ls
    assert "guardPanelLoadDuringCollect" in ui_js


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
    assert 'data-tab="trends"' in html or 'id="tab-panel-trends"' in html
    assert "/static/dashboard.trends.filters.adapter.js" in html
    trends_idx = html.index("/static/dashboard.trends.js")
    adapter_idx = html.index("/static/dashboard.trends.filters.adapter.js")
    assert adapter_idx < trends_idx


def test_live_incremental_fetches_all_pages_contract() -> None:
    tests_js = _read("web/static/dashboard.tests.js")
    failures_js = _read("web/static/dashboard.failures.js")
    init_js = _read("web/static/dashboard.init.js")
    assert "if (incr || !data.has_more)" not in tests_js
    assert "if (incr || !data.has_more)" not in failures_js
    assert "yieldToBrowser(24)" in tests_js
    assert "yieldToBrowser(24)" in failures_js
    assert "_dashIsCollecting) return;" not in init_js.split("pollCollect().finally")[1].split("});")[0]


def test_boot_loads_tables_during_collect_contract() -> None:
    init_js = _read("web/static/dashboard.init.js")
    boot_block = init_js.split("pollCollect().finally")[1].split("setLiveMode")[0]
    assert "loadBuilds()" in boot_block
    assert "loadSummary()" in boot_block
    assert "if (typeof _dashIsCollecting" not in boot_block


def test_refresh_all_skips_during_collect_contract() -> None:
    init_js = _read("web/static/dashboard.init.js")
    collect_js = _read("web/static/dashboard.collect-bar.js")
    ui_js = _read("web/static/dashboard.helpers.ui.js")
    assert "_dashIsCollecting" in init_js
    assert "pollCollect();" in init_js
    assert "return;" in init_js
    assert "pauseTableLoadsForCollect" in ui_js
    assert "schedulePostCollectRefresh" in ui_js
    assert "refreshAllStaggered" in init_js
    assert "schedulePostCollectRefresh()" in collect_js


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
