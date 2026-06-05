// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────
let _refreshAllRunning = false;
let _refreshAllPending = false;

/** Full dashboard reload. Single-flight: overlapping calls (SSE collect_done + pollCollect, rapid R key) coalesce. */
async function refreshAll() {
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
      // Reset all panels to page 1; cancel in-flight fetches so reload is not skipped.
      Object.values(_state).forEach((s) => {
        s.page = 1;
        s.done = false;
        s.loading = false;
      });
      ['builds', 'failures', 'tests', 'services'].forEach((k) => {
        try { abortFetchKey(k); } catch { /* ignore */ }
      });
      // Do not blank tables on refresh; keep current rows until new data arrives.

      // Update dropdowns (can change after Collect / settings updates).
      await populateSourcesAndInstances();
      await Promise.all([
        loadSummary(),
        loadBuilds(),
        loadFailures(),
        loadTests(),
        loadUptimeData().then(() => loadServices()),
        loadSystemStats(),
      ]);
      if (!_refreshAllPending) break;
    }
  } finally {
    _refreshAllRunning = false;
  }
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

  // Restore services "problems only" toggle
  try {
    _svcProblemsOnly = (localStorage.getItem('cimon-svc-problems') || '') === '1';
    const cb = document.getElementById('sv-problems-only');
    if (cb) cb.checked = _svcProblemsOnly;
    if (_svcProblemsOnly) {
      const sel = document.getElementById('f-svstatus');
      if (sel) sel.value = 'problems';
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

  // Render starred builds panel
  _renderFavPanel();

  // Initial data load: dropdowns + URL filters before table loads; observers after options exist.
  pollCollect();
  loadUptimeData().then(() => loadServices()); // load uptime before services render
  loadSummary();
  loadSystemStats();
  populateSourcesAndInstances().then(() => {
    _initObserver('builds', loadBuilds);
    _initObserver('failures', loadFailures);
    _initObserver('tests', loadTests);
    _initObserver('svcs', loadServices);
    loadBuilds();
    loadFailures();
    loadTests();
  });
  // LIVE-style refresh is always on; background collect runs via server config (no UI toggle).
  setLiveMode(true, { skipInitialFullRefresh: true }, false);
  restartSystemMonitorPolling();
});
