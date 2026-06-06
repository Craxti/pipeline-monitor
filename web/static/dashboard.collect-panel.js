// Collect auto-refresh during collect + tests-parse note: dashboard.collect-panel.js

// Load after dashboard.services.js, before dashboard.status-map.js.



let _lastPartialLiveCounts = null;

let _partialLiveRefreshTimer = null;

let _collectIncrementalBusy = false;

let _collectIncrementalRefresh = false;

let _lastIncrementalRunTs = 0;

let _lastPartialSsePayload = null;



/** Debounce SSE partial updates; min gap between DOM refreshes. */

const COLLECT_INCREMENTAL_DEBOUNCE_MS = 600;

const COLLECT_INCREMENTAL_MIN_INTERVAL_MS = 1100;

/** First page only during collect — avoids multi-page fetches that freeze the UI. */

const COLLECT_INCREMENTAL_PER_PAGE = 48;



function isCollectIncrementalRefresh() {

  return !!_collectIncrementalRefresh;

}



function collectIncrementalPerPage(defaultPerPage) {

  const d = Number(defaultPerPage) || 200;

  return Math.min(COLLECT_INCREMENTAL_PER_PAGE, d);

}



function updateTestsParseNote(summaryObj) {

  const el = document.getElementById('tests-parse-note');

  if (!el) return;

  const pc = summaryObj && summaryObj.parse_coverage;

  if (!pc || typeof pc !== 'object') {

    el.style.display = 'none';

    el.textContent = '';

    return;

  }

  const parts = [];

  for (const [k, v] of Object.entries(pc)) {

    if (!v || typeof v !== 'object') continue;

    const idx = v.jobs_indexed;

    const cj = v.console_jobs_parsed;

    const aj = v.allure_jobs_parsed;

    if (idx == null && cj == null && aj == null) continue;

    parts.push(`${k}: ~${idx ?? '—'} jobs in index; console ${cj ?? 0} jobs; Allure ${aj ?? 0} jobs`);

  }

  if (!parts.length) {

    el.style.display = 'none';

    el.textContent = '';

    return;

  }

  el.style.display = 'block';

  el.textContent = parts.join(' · ');

}



function _partialCountsChanged(prev, next) {

  if (!next || typeof next !== 'object') return false;

  if (!prev) return true;

  return (

    Number(prev.builds || 0) !== Number(next.builds || 0)

    || Number(prev.tests || 0) !== Number(next.tests || 0)

    || Number(prev.services || 0) !== Number(next.services || 0)

  );

}



function _partialPayloadChanged(prev, next) {

  if (!next || typeof next !== 'object') return false;

  if (!prev) return true;

  if (prev.revision != null && next.revision != null && Number(prev.revision) !== Number(next.revision)) {

    return true;

  }

  return _partialCountsChanged(prev.counts, next.counts);

}



function _prepIncrementalPanel(state, fetchKey, bumpGen) {

  try { abortFetchKey(fetchKey); } catch { /* ignore */ }

  if (typeof bumpGen === 'function') bumpGen();

  if (state) {

    state.page = 1;

    state.done = false;

    state.loading = false;

  }

}



async function _fetchSummaryDuringCollect() {

  const sumRes = await fetchKeyed('summary.summary', apiUrl('api/dashboard/summary')).catch(() => null);

  if (sumRes === FETCH_ABORTED || !sumRes || !sumRes.ok) return null;

  try { return await sumRes.json(); } catch { return null; }

}



async function _refreshIncidentsDuringCollect(summaryObj) {

  const statusRes = await fetchKeyed('summary.status.inc', apiUrl('api/status')).catch(() => null);

  if (statusRes === FETCH_ABORTED || !statusRes || !statusRes.ok) return;

  try {

    const snap = await statusRes.json();

    if (snap.error) return;

    if (typeof renderIncidentCenter === 'function') {

      renderIncidentCenter(snap, summaryObj, null);

    }

    const ic = document.getElementById('incident-center');

    if (ic) ic.style.display = '';

  } catch { /* ignore */ }

}



/** Soft reload of CI panels while collect streams partial snapshot via SSE. */

function refreshLivePanelsDuringCollect(payload) {

  if (!_liveMode || typeof _dashIsCollecting === 'undefined' || !_dashIsCollecting) return;

  const prev = _lastPartialSsePayload;

  if (!_partialPayloadChanged(prev, payload)) return;

  const counts = payload && payload.counts;

  _lastPartialLiveCounts = counts ? { ...counts } : null;

  _lastPartialSsePayload = payload;



  if (_partialLiveRefreshTimer) clearTimeout(_partialLiveRefreshTimer);

  _partialLiveRefreshTimer = setTimeout(() => {

    _partialLiveRefreshTimer = null;

    _runCollectIncrementalRefresh();

  }, COLLECT_INCREMENTAL_DEBOUNCE_MS);

}



/** Back-compat alias for SSE handler name. */

function refreshLiveTestsPanelsDuringCollect(payload) {

  return refreshLivePanelsDuringCollect(payload);

}



async function _runCollectIncrementalRefresh() {

  if (!_liveMode || typeof _dashIsCollecting === 'undefined' || !_dashIsCollecting) return;

  if (_collectIncrementalBusy) return;

  const now = Date.now();

  if (now - _lastIncrementalRunTs < COLLECT_INCREMENTAL_MIN_INTERVAL_MS) {

    const wait = COLLECT_INCREMENTAL_MIN_INTERVAL_MS - (now - _lastIncrementalRunTs);

    if (_partialLiveRefreshTimer) clearTimeout(_partialLiveRefreshTimer);

    _partialLiveRefreshTimer = setTimeout(() => {

      _partialLiveRefreshTimer = null;

      _runCollectIncrementalRefresh();

    }, wait);

    return;

  }



  _collectIncrementalBusy = true;

  _collectIncrementalRefresh = true;

  _lastIncrementalRunTs = Date.now();

  try {

    const summaryObj = await _fetchSummaryDuringCollect();

    try { updateTestsParseNote(summaryObj); } catch { /* ignore */ }



    const counts = _lastPartialSsePayload && _lastPartialSsePayload.counts;

    const c = summaryObj && summaryObj.counts ? summaryObj.counts : {};

    if (typeof _applySummaryCountsLight === 'function') {

      _applySummaryCountsLight({

        builds: Number(c.builds ?? counts?.builds ?? 0),

        tests_total: Number(c.tests_total ?? counts?.tests ?? 0),

        failed_builds: Number(c.failed_builds ?? (_lastTopRedCounts && _lastTopRedCounts.nFail) ?? 0),

        failed_tests: Number(c.failed_tests ?? (_lastTopRedCounts && _lastTopRedCounts.nTFail) ?? 0),

        services_down: Number(c.services_down ?? (_lastTopRedCounts && _lastTopRedCounts.nDown) ?? 0),

      });

    }



    const steps = [

      async () => {

        _prepIncrementalPanel(_state.builds, 'builds');

        if (typeof loadBuilds === 'function') await loadBuilds();

      },

      async () => {

        _prepIncrementalPanel(_state.failures, 'failures', () => { _failuresLoadGen++; });

        if (typeof loadFailures === 'function') await loadFailures();

      },

      async () => {

        _prepIncrementalPanel(_state.tests, 'tests', () => { _testsLoadGen++; });

        if (typeof loadTests === 'function') await loadTests();

      },

      async () => {

        _prepIncrementalPanel(_state.svcs, 'services');

        if (typeof loadUptimeData === 'function') await loadUptimeData();

        if (typeof loadServices === 'function') await loadServices();

      },

      async () => { await _refreshIncidentsDuringCollect(summaryObj); },

    ];



    for (const step of steps) {

      await step();

      if (typeof yieldToBrowser === 'function') await yieldToBrowser(36);

    }

  } catch { /* ignore */ }

  finally {

    _collectIncrementalRefresh = false;

    _collectIncrementalBusy = false;

  }

}



function _resetPartialLiveRefreshState() {

  _lastPartialLiveCounts = null;

  _lastPartialSsePayload = null;

  _lastIncrementalRunTs = 0;

  _collectIncrementalRefresh = false;

  if (_partialLiveRefreshTimer) {

    clearTimeout(_partialLiveRefreshTimer);

    _partialLiveRefreshTimer = null;

  }

}



/** Hook from loadSummary during collect — counts/top bar refresh (tables via SSE incremental). */

function _autoRefreshVisiblePanelsDuringCollect(summaryObj) {

  if (!_liveMode || typeof _dashIsCollecting === 'undefined' || !_dashIsCollecting) return;

  if (_collectIncrementalBusy) return;

  try {

    if (summaryObj && summaryObj.counts && typeof _applySummaryCountsLight === 'function') {

      _applySummaryCountsLight(summaryObj.counts);

    }

  } catch { /* ignore */ }

}



window.isCollectIncrementalRefresh = isCollectIncrementalRefresh;

window.collectIncrementalPerPage = collectIncrementalPerPage;


