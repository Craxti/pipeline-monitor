// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────
let _refreshAllRunning = false;
let _refreshAllPending = false;

async function _reloadAllTablePanelsStaggered() {
  const skipBuilds = typeof shouldSkipTableReloadDuringCollect === 'function'
    && shouldSkipTableReloadDuringCollect('builds', document.getElementById('tbody-builds'));
  const skipTests = typeof shouldSkipTableReloadDuringCollect === 'function'
    && shouldSkipTableReloadDuringCollect('tests', document.getElementById('tbody-tests'));
  const skipFailures = typeof shouldSkipTableReloadDuringCollect === 'function'
    && shouldSkipTableReloadDuringCollect('failures', document.getElementById('tbody-failures'));
  const skipSvcs = typeof shouldSkipTableReloadDuringCollect === 'function'
    && shouldSkipTableReloadDuringCollect('svcs', document.getElementById('tbody-svcs'));
  ['builds', 'failures', 'tests', 'services'].forEach((k) => {
    if (k === 'builds' && skipBuilds) return;
    if (k === 'tests' && skipTests) return;
    if (k === 'failures' && skipFailures) return;
    if (k === 'services' && skipSvcs) return;
    try { abortFetchKey(k); } catch { /* ignore */ }
  });
  if (skipBuilds) { _state.builds.done = true; _state.builds.loading = false; }
  if (skipTests) { _state.tests.done = true; _state.tests.loading = false; }
  if (skipFailures) { _state.failures.done = true; _state.failures.loading = false; }
  if (skipSvcs) { _state.svcs.done = true; _state.svcs.loading = false; }

  const steps = [];
  if (_dashTab === 'system' && typeof loadSystemStats === 'function') {
    steps.push(() => loadSystemStats());
  }
  if (!skipBuilds) steps.push(() => loadBuilds());
  if (!skipFailures) steps.push(() => loadFailures());
  if (!skipTests) steps.push(() => loadTests());
  if (!skipSvcs) steps.push(() => loadUptimeData().then(() => loadServices()));
  else steps.push(() => loadUptimeData());

  for (const step of steps) {
    await step();
    if (typeof yieldToBrowser === 'function') await yieldToBrowser(48);
  }
}

async function _reloadAllTablePanels() {
  return _reloadAllTablePanelsStaggered();
}

/** Full dashboard reload with yields between panels (UI stays clickable). */
async function refreshAllStaggered() {
  if (typeof _dashIsCollecting !== 'undefined' && _dashIsCollecting) {
    pollCollect();
    return;
  }
  if (_refreshAllRunning) {
    _refreshAllPending = true;
    return;
  }
  _refreshAllRunning = true;
  try {
    let _refreshPasses = 0;
    for (;;) {
      if (++_refreshPasses > 8) break;
      _refreshAllPending = false;
      Object.values(_state).forEach((s) => {
        s.page = 1;
        s.done = false;
        s.loading = false;
      });

      await populateSourcesAndInstances();
      await loadSummary();
      if (typeof yieldToBrowser === 'function') await yieldToBrowser(0);
      await _reloadAllTablePanelsStaggered();
      if (!_refreshAllPending) break;
    }
    if (_dashTab === 'trends' && typeof loadTrends === 'function') {
      if (!(typeof shouldSkipTrendsReloadDuringCollect === 'function' && shouldSkipTrendsReloadDuringCollect())) {
        loadTrends(typeof _trendsViewDays === 'number' ? _trendsViewDays : 14, null);
      }
    }
  } finally {
    _refreshAllRunning = false;
  }
}

/** Full dashboard reload. Single-flight: overlapping calls (SSE collect_done + pollCollect, rapid R key) coalesce. */
async function refreshAll() {
  return refreshAllStaggered();
}

document.addEventListener('DOMContentLoaded', () => {
  initDashDelegatedActions();
  initDashFormControlBindings();
  applyUITexts();
  _loadCollapsedBuildGroups();
  initDashboardTabs();
  initDashSidebarNav();
  initBackToTop();
  document.getElementById('ic-open-logs')?.addEventListener('click', icOpenFirstFailureLog);
  [
    ['btn-collect', 'dash.collect'],
    ['btn-collect-full', 'dash.collect_full'],
    ['btn-collect-full', 'dash.collect_full'],
    ['btn-theme', 'dash.theme'],
    ['btn-compact', 'dash.compact'],
    ['notif-btn', 'dash.notif_btn'],
  ].forEach(([id, k]) => {
    const el = document.getElementById(id);
    if (el) el.setAttribute('aria-label', t(k));
  });

  // Restore theme & compact from localStorage
  _applyTheme(localStorage.getItem('cimon-theme') || 'dark');
  if (localStorage.getItem('cimon-compact')) {
    toggleCompact();
  } else {
    const bc = document.getElementById('btn-compact');
    if (bc) {
      bc.setAttribute('title', t('dash.compact_off'));
      bc.setAttribute('aria-label', t('dash.compact_off'));
    }
  }

  // Read filters from URL
  _readURLFilters();
  try { _migrateLegacyTestSourceSelect(); } catch { /* ignore */ }
  _hookFilterURLSync();

  // Restore tests time filter + quick source buttons
  try {
    const th = parseInt(localStorage.getItem('cimon-tests-hours') || '0', 10);
    _testsHours = isNaN(th) ? 0 : th;
    ['tf-t-6h','tf-t-24h','tf-t-7d'].forEach((id) => document.getElementById(id)?.classList.remove('active'));
    if (_testsHours === 6) document.getElementById('tf-t-6h')?.classList.add('active');
    if (_testsHours === 24) document.getElementById('tf-t-24h')?.classList.add('active');
    if (_testsHours === 168) document.getElementById('tf-t-7d')?.classList.add('active');
  } catch { /* ignore */ }
  try {
    const fd = parseInt(localStorage.getItem('cimon-failures-days') || '0', 10);
    _failuresDays = fd === 1 || fd === 3 || fd === 7 || fd === 30 ? fd : 0;
    ['tf-f-1d','tf-f-3d','tf-f-7d','tf-f-30d'].forEach((id) => document.getElementById(id)?.classList.remove('active'));
    if (_failuresDays === 1) document.getElementById('tf-f-1d')?.classList.add('active');
    if (_failuresDays === 3) document.getElementById('tf-f-3d')?.classList.add('active');
    if (_failuresDays === 7) document.getElementById('tf-f-7d')?.classList.add('active');
    if (_failuresDays === 30) document.getElementById('tf-f-30d')?.classList.add('active');
  } catch { /* ignore */ }
  updateFailuresExportLinks();
  _syncTestSourceQuickButtons();

  // Migrate legacy services "problems only" checkbox → status select
  try {
    if (localStorage.getItem('cimon-svc-problems') === '1') {
      const sel = document.getElementById('f-svstatus');
      if (sel && !sel.value) sel.value = 'problems';
      localStorage.removeItem('cimon-svc-problems');
    }
  } catch { /* ignore */ }

  document.addEventListener('keydown', (e) => {
    // Hotkeys (avoid interfering with typing)
    const tEl = e.target;
    const tag = tEl && tEl.tagName ? String(tEl.tagName).toLowerCase() : '';
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (tEl && tEl.isContentEditable);
    if (!typing) {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const gs = document.getElementById('global-search');
        if (gs) { gs.focus(); gs.select(); }
      }
      if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        refreshAll();
      }
      if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        triggerCollect();
      }
      if (e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const idx = parseInt(e.key, 10) - 1;
        if (DASH_TABS[idx]) {
          e.preventDefault();
          setDashboardTab(DASH_TABS[idx]);
        }
      }
    }
    if (e.key !== 'Escape') return;
    const tcModal = document.getElementById('trends-chart-modal');
    if (tcModal && tcModal.classList.contains('open')) {
      if (typeof closeTrendsChartModal === 'function') closeTrendsChartModal();
      return;
    }
    const rb = document.getElementById('runbook-modal');
    if (rb && rb.classList.contains('open')) closeRunbook();
  });

  const _normLegacyTab = (t) => {
    if (t === 'tests') return 'test-failures';
    if (t === 'logs') return 'overview';
    return t;
  };
  const pTabRaw = new URLSearchParams(location.search).get('tab');
  const pTab = pTabRaw === 'log-intel' ? 'log-intel' : _normLegacyTab(pTabRaw);
  let storedRaw = localStorage.getItem('cimon-dash-tab');
  if (storedRaw === 'tests') {
    try {
      localStorage.setItem('cimon-dash-tab', 'test-failures');
    } catch { /* ignore */ }
    storedRaw = 'test-failures';
  }
  if (storedRaw === 'logs') {
    try {
      localStorage.setItem('cimon-dash-tab', 'overview');
    } catch { /* ignore */ }
    storedRaw = 'overview';
  }
  const stored = _normLegacyTab(storedRaw);
  let initTab = (pTab && DASH_TABS.includes(pTab)) ? pTab : (stored && DASH_TABS.includes(stored) ? stored : 'overview');
  if (!DASH_TABS.includes(initTab)) initTab = 'overview';
  setDashboardTab(initTab, { skipUrl: true });
  if (initTab === 'log-intel' && typeof loadLogIntelList === 'function') loadLogIntelList();
  if (initTab === 'trends') {
    try {
      if (typeof initTrendsFiltersFromStorage === 'function') initTrendsFiltersFromStorage();
    } catch { /* ignore */ }
    if (typeof loadTrends === 'function') {
      loadTrends(typeof _trendsViewDays === 'number' ? _trendsViewDays : 14, null);
    }
  }

  // Render starred builds panel
  _renderFavPanel();

  // Initial data load: all CI tables in background unless collect is already running.
  pollCollect().finally(() => {
    if (typeof _dashIsCollecting !== 'undefined' && _dashIsCollecting) return;
    loadUptimeData().then(() => loadServices());
    loadSummary();
    loadSystemStats();
    populateSourcesAndInstances().then(() => {
      if (typeof _dashIsCollecting !== 'undefined' && _dashIsCollecting) return;
      if (typeof _initAllTableObservers === 'function') _initAllTableObservers();
      loadBuilds();
      loadFailures();
      loadTests();
    });
  });
  // LIVE-style refresh is always on; background collect runs via server config (no UI toggle).
  setLiveMode(true, { skipInitialFullRefresh: true }, false);
  restartSystemMonitorPolling();
});
