// loadSummary — snapshot fetch, stat cards, incident hook, map/spark/timeline/flaky refresh.
// Load after dashboard.uptime-sparklines.js, before dashboard.collect-bar.js.

// ─────────────────────────────────────────────────────────────────────────────
// Summary stats & anomalies
// ─────────────────────────────────────────────────────────────────────────────
async function loadSummary() {
  const banner = document.getElementById('no-data-banner');
  const [res, pres, metaRes, sumRes] = await Promise.all([
    fetchKeyed('summary.status', apiUrl('api/status')).catch(() => null),
    fetchKeyed('summary.events', apiUrl('api/events/persisted?limit=300')).catch(() => null),
    fetchKeyed('summary.meta', apiUrl('api/meta')).catch(() => null),
    fetchKeyed('summary.summary', apiUrl('api/dashboard/summary')).catch(() => null),
  ]);

  if (res === FETCH_ABORTED || pres === FETCH_ABORTED || metaRes === FETCH_ABORTED || sumRes === FETCH_ABORTED) {
    return;
  }

  let metaObj = null;
  if (metaRes && metaRes.ok) {
    try {
      metaObj = await metaRes.json();
    } catch { /* ignore */ }
  }
  let summaryObj = null;
  if (sumRes && sumRes.ok) {
    try {
      summaryObj = await sumRes.json();
    } catch { /* ignore */ }
  }
  if (summaryObj) {
    try { updateTestsParseNote(summaryObj); } catch (e) { /* ignore */ }
    try { _autoRefreshVisiblePanelsDuringCollect(summaryObj); } catch (e) { /* ignore */ }
  }
  if (metaObj) {
    _jobAnalytics = metaObj.job_analytics || {};
    const wu = metaObj.web_ui;
    if (wu && typeof wu.live_dashboard_poll_seconds !== 'undefined') {
      const next = _clampLiveDashboardPollSec(wu.live_dashboard_poll_seconds);
      if (next !== _liveDashboardPollSec) {
        _liveDashboardPollSec = next;
        try { restartLiveDashboardTimers(); } catch { /* live.js not loaded yet */ }
      }
    }
    updateCorrelationHint(metaObj);
  } else {
    const ch = document.getElementById('correlation-hint');
    if (ch) ch.style.display = 'none';
  }

  if (!res || !res.ok) {
    if (banner) {
      banner.classList.add('visible');
      banner.innerHTML =
        t('no_data.text') +
        ' <a href="settings">' +
        t('no_data.settings') +
        '</a>. ' +
        t('no_data.collect');
    }
    const sit = document.getElementById('situation-strip');
    if (sit) sit.style.display = 'none';
    const ex = document.getElementById('exec-health-line');
    if (ex) ex.classList.remove('visible');
    const ic = document.getElementById('incident-center');
    if (ic) ic.style.display = 'none';
    return;
  }
  const snap = await res.json();
  _lastSnap = snap;
  if (snap.error) {
    if (banner) {
      banner.classList.add('visible');
      banner.innerHTML =
        t('no_data.text') +
        ' <a href="settings">' +
        t('no_data.settings') +
        '</a>. ' +
        t('no_data.collect');
    }
    const ic = document.getElementById('incident-center');
    if (ic) ic.style.display = 'none';
    return;
  }
  if (banner) banner.classList.remove('visible');

  let persistedItems = [];
  if (pres && pres.ok) {
    try { persistedItems = (await pres.json()).items || []; } catch { /* ignore */ }
  }
  _persistedEvents = persistedItems || [];

  const builds = snap.builds || [];
  const tests  = snap.tests  || [];
  const svcs   = snap.services || [];

  renderIncidentCenter(snap, summaryObj, metaObj);

  document.getElementById('s-builds').textContent = builds.length;
  document.getElementById('s-ok').textContent     = builds.filter(b=>b.status==='success').length;
  document.getElementById('s-fail').textContent   = builds.filter(b=>b.status==='failure').length;
  document.getElementById('s-run').textContent    = builds.filter(b=>b.status==='running').length;
  document.getElementById('s-tfail').textContent  = tests.filter(t=>['failed','error'].includes(t.status)).length;
  document.getElementById('s-tpass').textContent  = tests.filter(t=>t.status==='passed').length;
  const nDown = svcs.filter((s) => s.status === 'down').length;
  const nFail = builds.filter((b) => b.status === 'failure').length;
  const nTFail = tests.filter((t) => ['failed', 'error'].includes(t.status)).length;
  document.getElementById('s-down').textContent = nDown;
  updateSituationStrip(nFail, nTFail, nDown);
  try { updateTopStatusBar(metaObj, summaryObj, nFail, nTFail, nDown); } catch (e) { /* ignore */ }

  // Anomalies
  const aDiv = document.getElementById('anomalies');
  if (aDiv) {
    aDiv.innerHTML = '';
    const jobMap = {};
    builds.filter(b=>b.critical).forEach(b => {
      (jobMap[b.job_name] = jobMap[b.job_name]||[]).push(b.status);
    });
    for (const [job, statuses] of Object.entries(jobMap)) {
      let c = 0;
      statuses.forEach(s => { c = s==='failure' ? c+1 : 0; });
      if (c >= 2) {
        aDiv.insertAdjacentHTML('beforeend',
          `<div class="anomaly">[!!] Critical job <strong>${esc(job)}</strong> — <strong>${c}</strong> consecutive failures!</div>`);
      }
    }
  }

  // Status Map — uses same data, no extra API call
  renderStatusMap(builds, svcs);
  // Sparklines — snapshot first (instant), SQLite batch enriches after idle
  _buildSparkData(builds);
  scheduleSparklineFetch([...new Set(builds.map(b => b.job_name))]);
  // Timeline — persisted state changes + snapshot activity (deduped)
  renderTimeline(builds, svcs, persistedItems);

  let dbFlakyItems = [];
  let flakyErr = null;
  try {
    const ds = await fetch(apiUrl('api/db/stats'));
    const dj = ds.ok ? await ds.json() : {};
    if (dj.enabled) {
      const fr = await fetch(apiUrl('api/analytics/flaky'));
      if (fr.ok) {
        dbFlakyItems = (await fr.json()).items || [];
      } else {
        const d = await fetchApiErrorDetail(fr);
        flakyErr = d ? `Flaky API: ${d}` : `Flaky API HTTP ${fr.status}`;
      }
    }
  } catch (e) {
    flakyErr = (e && e.message) ? String(e.message) : 'Network error';
  }
  renderFlakyAndCorrelation(builds, dbFlakyItems, flakyErr);
  _renderFavPanel();
  updateExecHealthLine();
  _finalizeStatTrends();
}
