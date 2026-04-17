function applyLivePollingIntervals(opts) {
  opts = opts || {};
  const skipInitialFullRefresh = !!opts.skipInitialFullRefresh;

  if (_ivPollCollect) clearInterval(_ivPollCollect);
  if (_ivLoadSummary) clearInterval(_ivLoadSummary);
  if (_ivNotif) clearInterval(_ivNotif);
  if (_ivAutoRefresh) clearInterval(_ivAutoRefresh);
  _ivPollCollect = null;
  _ivLoadSummary = null;
  _ivNotif = null;
  _ivAutoRefresh = null;

  // If LIVE is off: no full dashboard polling; still ping collect/status so ETA ticks and Collect state stays fresh.
  if (!_liveMode) {
    try { if (_eventSource) _eventSource.close(); } catch { /* ignore */ }
    _eventSource = null;
    _ivPollCollect = setInterval(pollCollect, 12000);
    pollCollect();
    return;
  }

  // LIVE is on: SSE collect_done + periodic refresh. Skip the first full refresh on dashboard boot — DOMContentLoaded
  // already kicks off loadSummary / populate / table loads; running refreshAll() in parallel aborts those fetchKeyed calls.
  initEventSource(); // collect_done toast + refresh (LIVE only)
  if (!skipInitialFullRefresh) {
    refreshAll();
  }
  pollCollect();
  _ivAutoRefresh = setInterval(() => {
    refreshAll();
    pollCollect();
  }, 5 * 60 * 1000);
}

/**
 * @param {boolean} on
 * @param {{ skipInitialFullRefresh?: boolean }} [opts]
 * @param {boolean} [syncServer] When false, do not POST /api/collect/auto (used on first paint if LIVE is off,
 *   so headless ``web.auto_collect`` stays enabled). Omit or true: always sync (checkbox changes).
 */
function setLiveMode(on, opts, syncServer) {
  opts = opts || {};
  if (syncServer === undefined) syncServer = true;
  _liveMode = !!on;
  try { localStorage.setItem('cimon-live', _liveMode ? '1' : '0'); } catch { /* ignore */ }
  document.body.classList.toggle('dashboard-live', _liveMode);
  const w = document.getElementById('live-toggle-wrap');
  if (w) w.classList.toggle('is-live', _liveMode);
  const chk = document.getElementById('chk-live-mode');
  if (chk) chk.checked = _liveMode;
  if (syncServer) {
    try {
      fetch(apiUrl('api/collect/auto'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: _liveMode }),
      }).catch(() => null);
    } catch { /* ignore */ }
  }
  applyLivePollingIntervals(opts);
}

