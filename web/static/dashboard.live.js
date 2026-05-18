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
  const period = typeof liveDashboardPollMs === 'function' ? liveDashboardPollMs() : 20000;
  _ivAutoRefresh = setInterval(() => {
    refreshAll();
    pollCollect();
  }, period);
}

/** Re-schedule LIVE timers after config from /api/meta changes (poll interval). */
function restartLiveDashboardTimers() {
  if (!_liveMode) return;
  applyLivePollingIntervals({ skipInitialFullRefresh: true });
}

/**
 * @param {boolean} on
 * @param {{ skipInitialFullRefresh?: boolean }} [opts]
 * @param {boolean} [_syncServer] Deprecated; background collect is always on (no /api/collect/auto from UI).
 */
function setLiveMode(on, opts, _syncServer) {
  opts = opts || {};
  _liveMode = !!on;
  document.body.classList.toggle('dashboard-live', _liveMode);
  const w = document.getElementById('live-toggle-wrap');
  if (w) w.classList.toggle('is-live', _liveMode);
  const chk = document.getElementById('chk-live-mode');
  if (chk) chk.checked = _liveMode;
  applyLivePollingIntervals(opts);
}

