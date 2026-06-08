// Collect auto-refresh during collect + tests-parse note: dashboard.collect-panel.js

// Load after dashboard.services.js, before dashboard.status-map.js.



/** Counts last applied to table panels — distinct from SSE payload (which is set before debounced refresh). */
let _lastIncrementalAppliedCounts = null;

let _partialLiveRefreshTimer = null;

let _collectIncrementalBusy = false;

let _collectIncrementalRefresh = false;

let _lastIncrementalRunTs = 0;

let _lastPartialSsePayload = null;

let _collectIncrementalPending = false;



/** Debounce SSE partial updates; min gap between DOM refreshes. */

const COLLECT_INCREMENTAL_DEBOUNCE_MS = 280;

const COLLECT_INCREMENTAL_MIN_INTERVAL_MS = 350;

/** Heavy endpoints (full /api/status, trends) — throttle during collect so tables stay responsive. */
const COLLECT_HEAVY_PANEL_MIN_INTERVAL_MS = 5000;

let _lastIncidentsLiveRefreshTs = 0;

let _lastTrendsLiveRefreshTs = 0;

function isCollectIncrementalRefresh() {

  return !!_collectIncrementalRefresh;

}



function collectIncrementalPerPage(defaultPerPage) {

  return Number(defaultPerPage) || 200;

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

  if (prev.phase != null && next.phase != null && String(prev.phase) !== String(next.phase)) {

    return true;

  }

  const prevPhases = Array.isArray(prev.active_phases) ? prev.active_phases.join(',') : '';

  const nextPhases = Array.isArray(next.active_phases) ? next.active_phases.join(',') : '';

  if (nextPhases && prevPhases !== nextPhases) return true;

  return _partialCountsChanged(prev.counts, next.counts);

}



function _incrTabNeedsBuilds(tab, buildsCountDelta) {

  return buildsCountDelta || tab === 'builds';

}



function _incrTabNeedsTests(tab, testsCountDelta) {

  return testsCountDelta || tab === 'test-runs' || tab === 'test-failures';

}



function _incrTabNeedsSvcs(tab, svcsCountDelta) {

  return svcsCountDelta || tab === 'services';

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



/** Lightweight top-bar / meta refresh — avoids full /api/status (~MB JSON) every tick. */
async function _applyLightSummaryDuringCollect(summaryObj) {

  if (summaryObj && summaryObj.counts && typeof _applySummaryCountsLight === 'function') {

    _applySummaryCountsLight(summaryObj.counts);

  }

  try { updateTestsParseNote(summaryObj); } catch { /* ignore */ }

  const metaRes = await fetchKeyed('summary.meta.live', apiUrl('api/meta')).catch(() => null);

  if (metaRes === FETCH_ABORTED) return;

  let metaObj = null;

  if (metaRes && metaRes.ok) {

    try { metaObj = await metaRes.json(); } catch { /* ignore */ }

  }

  if (metaObj) {

    _jobAnalytics = metaObj.job_analytics || {};

    try { updateCorrelationHint(metaObj); } catch { /* ignore */ }

  }

  try {

    updateTopStatusBar(

      metaObj,

      summaryObj,

      _lastTopRedCounts.nFail,

      _lastTopRedCounts.nTFail,

      _lastTopRedCounts.nDown,

    );

  } catch { /* ignore */ }

}



async function _refreshIncidentsDuringCollect(summaryObj) {

  const now = Date.now();

  if (now - _lastIncidentsLiveRefreshTs < COLLECT_HEAVY_PANEL_MIN_INTERVAL_MS) return;

  if (typeof _dashTab !== 'undefined' && _dashTab !== 'overview') return;

  _lastIncidentsLiveRefreshTs = now;

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

  if (_collectIncrementalBusy) {

    _collectIncrementalPending = true;

    return;

  }

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

        successful_builds: Number(c.successful_builds ?? Math.max(0, Number(c.builds ?? counts?.builds ?? 0) - Number(c.failed_builds ?? (_lastTopRedCounts && _lastTopRedCounts.nFail) ?? 0))),

        failed_builds: Number(c.failed_builds ?? (_lastTopRedCounts && _lastTopRedCounts.nFail) ?? 0),

        services_total: Number(c.services_total ?? counts?.services ?? 0),

        failed_tests: Number(c.failed_tests ?? (_lastTopRedCounts && _lastTopRedCounts.nTFail) ?? 0),

        services_down: Number(c.services_down ?? (_lastTopRedCounts && _lastTopRedCounts.nDown) ?? 0),

      });

    }



    const prev = _lastIncrementalAppliedCounts ? { ..._lastIncrementalAppliedCounts } : null;

    const nextBuilds = Number((counts && counts.builds) ?? (c.builds ?? 0));

    const nextTests = Number((counts && counts.tests) ?? (c.tests_total ?? c.tests ?? 0));

    const nextSvcs = Number((counts && counts.services) ?? (c.services_total ?? c.services ?? 0));

    const buildsCountDelta = !prev || Number(prev.builds || 0) !== nextBuilds;

    const testsCountDelta = !prev || Number(prev.tests || 0) !== nextTests;

    const svcsCountDelta = !prev || Number(prev.services || 0) !== nextSvcs;

    const tab = typeof _dashTab !== 'undefined' ? _dashTab : '';

    const steps = [];

    steps.push(async () => {

      if (typeof populateSourcesAndInstances === 'function') await populateSourcesAndInstances();

    });

    steps.push(async () => {

      await _applyLightSummaryDuringCollect(summaryObj);

    });

    steps.push(async () => { await _refreshIncidentsDuringCollect(summaryObj); });

    if (typeof _dashTab !== 'undefined' && _dashTab === 'system' && typeof loadSystemStats === 'function') {

      steps.push(async () => { await loadSystemStats(); });

    }

    steps.push(async () => {

      _prepIncrementalPanel(_state.builds, 'builds');

      _prepIncrementalPanel(_state.failures, 'failures', () => { _failuresLoadGen++; });

      _prepIncrementalPanel(_state.tests, 'tests', () => { _testsLoadGen++; });

      _prepIncrementalPanel(_state.svcs, 'services');

      const tableLoads = [];

      if (typeof loadBuilds === 'function') tableLoads.push(loadBuilds());

      if (typeof loadFailures === 'function') tableLoads.push(loadFailures());

      if (typeof loadTests === 'function') tableLoads.push(loadTests());

      if (typeof loadUptimeData === 'function') {

        tableLoads.push(loadUptimeData().then(() => {

          if (typeof loadServices === 'function') return loadServices();

        }));

      } else if (typeof loadServices === 'function') {

        tableLoads.push(loadServices());

      }

      await Promise.all(tableLoads.map((p) => p.catch(() => {})));

    });

    if (typeof loadTrends === 'function') {

      const trendsNow = Date.now();

      if (trendsNow - _lastTrendsLiveRefreshTs >= COLLECT_HEAVY_PANEL_MIN_INTERVAL_MS) {

        _lastTrendsLiveRefreshTs = trendsNow;

        steps.push(async () => {

          await loadTrends(typeof _trendsViewDays === 'number' ? _trendsViewDays : 14, null);

        });

      }

    }



    for (const step of steps) {

      await step().catch(() => {});

      if (typeof yieldToBrowser === 'function') await yieldToBrowser(20);

    }

    if (buildsCountDelta || testsCountDelta || svcsCountDelta) {

      _lastIncrementalAppliedCounts = { builds: nextBuilds, tests: nextTests, services: nextSvcs };

    }

  } catch { /* ignore */ }

  finally {

    _collectIncrementalRefresh = false;

    _collectIncrementalBusy = false;

    if (_collectIncrementalPending) {

      _collectIncrementalPending = false;

      setTimeout(() => { _runCollectIncrementalRefresh(); }, 80);

    }

  }

}



function _resetPartialLiveRefreshState() {

  _collectIncrementalPending = false;

  _lastIncrementalAppliedCounts = null;

  _lastPartialSsePayload = null;

  _lastIncrementalRunTs = 0;

  _lastIncidentsLiveRefreshTs = 0;

  _lastTrendsLiveRefreshTs = 0;

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



/** Fallback when SSE is slow — pollCollect passes fresh progress_counts. */

function notifyCollectCountsChanged(counts, phase, revision, activePhases) {

  if (!_liveMode || typeof _dashIsCollecting === 'undefined' || !_dashIsCollecting) return;

  if (!counts || typeof counts !== 'object') return;

  refreshLivePanelsDuringCollect({
    type: 'snapshot_partial',
    counts,
    phase: phase ?? null,
    revision: revision != null ? revision : null,
    active_phases: Array.isArray(activePhases) ? activePhases : null,
  });

}



window.isCollectIncrementalRefresh = isCollectIncrementalRefresh;

window.collectIncrementalPerPage = collectIncrementalPerPage;

window.notifyCollectCountsChanged = notifyCollectCountsChanged;


