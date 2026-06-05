// Collect status bar, pollCollect, slow-top list, triggerCollect (shared timers with dashboard.live.js).
// Load after dashboard.load-summary.js, before dashboard.js (shim / index comments).

// ─────────────────────────────────────────────────────────────────────────────
// Collection status bar
// ─────────────────────────────────────────────────────────────────────────────
let _collectInterval = 300, _lastCollectedAt = null, _ticker = null;
/** True while server reports collect in progress — used to avoid flashing empty tables on transient snapshot gaps. */
let _dashIsCollecting = false;
/** Dashboard always uses LIVE-style polling (no toggle). */
let _liveMode = true;
let _ivPollCollect = null, _ivLoadSummary = null, _ivNotif = null;
let _ivAutoRefresh = null;
let _ivCollectFastPoll = null;
let _eventSource = null;
let _etaNextCollect = null;
let _autoCollectEnabled = false;
let _collectElapsedTimer = null;
let _collectStartedAt = null;

function updateCollectBar(state) {
  const dot = document.getElementById('cdot');
  const errEl = document.getElementById('collect-err');
  const btn = document.getElementById('btn-collect');
  const fullBtn = document.getElementById('btn-collect-full');
  const stopBtn = document.getElementById('btn-collect-stop');
  if (!dot || !btn) return;

  _dashIsCollecting = !!(state && state.is_collecting);

  const hasErr = state.last_error != null && String(state.last_error).trim() !== '';

  _collectInterval = state.interval_seconds || 300;
  _lastCollectedAt = state.last_collected_at ? new Date(state.last_collected_at) : null;
  _etaNextCollect = typeof state.next_collect_in_seconds === 'number' ? Math.max(0, state.next_collect_in_seconds) : null;
  _autoCollectEnabled = !!state.auto_collect_enabled;

  if (_collectElapsedTimer) { clearInterval(_collectElapsedTimer); _collectElapsedTimer = null; }
  if (_ticker) { clearInterval(_ticker); _ticker = null; }

  dot.className = 'dot';

  if (state.is_collecting) {
    if (!_collectStartedAt) _collectStartedAt = Date.now();
    dot.classList.add('collecting');
    btn.disabled = true;
    if (fullBtn) fullBtn.disabled = true;
    if (stopBtn) {
      stopBtn.classList.remove('collect-stop-hidden');
      stopBtn.disabled = false;
    }
    if (errEl) {
      errEl.textContent = '';
      errEl.style.display = 'none';
      errEl.removeAttribute('title');
    }
    const tickEl = () => {
      const sec = Math.floor((Date.now() - (_collectStartedAt || Date.now())) / 1000);
      const main = state.progress_main || t('dash.collecting');
      const counts = state.progress_counts || {};
      const cnt = (typeof counts.builds === 'number' || typeof counts.tests === 'number' || typeof counts.services === 'number')
        ? ` · builds=${counts.builds ?? 0} tests=${counts.tests ?? 0} svcs=${counts.services ?? 0}`
        : '';
      const sub = state.progress_sub
        ? `${state.progress_sub} · ${t('dash.collect_elapsed')}: ${fmtSec(sec)}${cnt}`
        : `${t('dash.collect_elapsed')}: ${fmtSec(sec)}${cnt}`;
      _setCollectLines(main, sub);
    };
    tickEl();
    _collectElapsedTimer = setInterval(tickEl, 1000);
    return;
  }

  _collectStartedAt = null;
  btn.disabled = false;
  if (fullBtn) fullBtn.disabled = false;
  if (stopBtn) {
    stopBtn.classList.add('collect-stop-hidden');
    stopBtn.disabled = true;
  }

  if (hasErr) {
    dot.classList.add('err');
    _setCollectLines(
      _lastCollectedAt ? `${t('dash.collect_snapshot_prefix')}: ${fmt(_lastCollectedAt)}` : t('dash.collect_error_short'),
      null
    );
    if (errEl) {
      errEl.textContent = String(state.last_error);
      errEl.style.display = 'block';
      errEl.setAttribute('title', String(state.last_error));
    }
    return;
  }

  if (errEl) {
    errEl.textContent = '';
    errEl.style.display = 'none';
    errEl.removeAttribute('title');
  }

  const paintIdle = () => {
    const snapLine = _lastCollectedAt
      ? `${t('dash.collect_snapshot_prefix')}: ${fmt(_lastCollectedAt)}`
      : t('dash.collect_no_data');
    let nextLine = '';
    if (_autoCollectEnabled) {
      let rem = null;
      if (_lastCollectedAt) {
        rem = Math.max(0, _collectInterval - Math.floor((Date.now() - _lastCollectedAt.getTime()) / 1000));
      } else if (_etaNextCollect != null) {
        rem = Math.max(0, _etaNextCollect);
      }
      if (rem != null && rem > 0) {
        nextLine = `${t('dash.collect_next_autocollect_prefix')}: ${fmtSec(rem)}`;
      } else if (_lastCollectedAt) {
        nextLine = t('dash.collecting_soon');
      } else {
        nextLine = t('dash.collect_eta_waiting');
      }
      if (!_lastCollectedAt && _etaNextCollect != null && _etaNextCollect > 0) {
        _etaNextCollect = Math.max(0, _etaNextCollect - 1);
      }
    } else {
      nextLine = t('dash.collect_autocollect_off');
    }
    _setCollectLines(snapLine, nextLine || null);
  };
  paintIdle();
  if (!hasErr) {
    _ticker = setInterval(paintIdle, 1000);
  }
}

let _prevCollecting = false;

async function pollCollect() {
  const res = await fetch(apiUrl('api/collect/status')).catch(()=>null);
  if (!res || !res.ok) return;
  const state = await res.json();
  updateCollectBar(state);
  if (state.is_collecting) {
    if (!_ivCollectFastPoll) {
      _ivCollectFastPoll = setInterval(() => { pollCollect(); }, 2500);
    }
  } else if (_ivCollectFastPoll) {
    clearInterval(_ivCollectFastPoll);
    _ivCollectFastPoll = null;
  }
  // During collect we want visible panels to update often (pollCollect runs every 2–3s).
  try { _autoRefreshVisiblePanelsDuringCollect({ collect: state }); } catch { /* ignore */ }
  if (_prevCollecting && !state.is_collecting) {
    // Same moment is_collecting flips false, refreshAll runs — keepTable grace needs this even without SSE.
    try {
      _lastCollectFinishedAt = Date.now();
    } catch { /* ignore */ }
    refreshAll();
  }
  _prevCollecting = state.is_collecting;
}

async function stopCollect() {
  const stopBtn = document.getElementById('btn-collect-stop');
  if (stopBtn) stopBtn.disabled = true;
  const res = await fetch(apiUrl('api/collect/stop'), { method: 'POST' }).catch(() => null);
  if (stopBtn) stopBtn.disabled = false;
  if (!res || !res.ok) {
    const d = res ? await res.json().catch(() => ({})) : {};
    showToast((d && d.message) || (d && d.detail) || (res && res.statusText) || 'Stop failed', 'warn');
    return;
  }
  const j = await res.json().catch(() => ({}));
  if (j.ok === false) {
    showToast(j.message || 'Nothing to stop', 'warn');
    return;
  }
  showToast(t('dash.collect_stop_sent'), 'ok');
  pollCollect();
}

async function triggerCollect(forceFull = false) {
  if (_ticker) { clearInterval(_ticker); _ticker = null; }
  const btn = document.getElementById('btn-collect');
  const fullBtn = document.getElementById('btn-collect-full');
  if (btn) btn.disabled = true;
  if (fullBtn) fullBtn.disabled = true;
  _collectStartedAt = Date.now();
  const cdot = document.getElementById('cdot');
  if (cdot) cdot.className = 'dot collecting';
  const tickPre = () => {
    const sec = Math.floor((Date.now() - _collectStartedAt) / 1000);
    const main = forceFull ? t('dash.collecting_full') : t('dash.collecting');
    _setCollectLines(main, `${t('dash.collect_elapsed')}: ${fmtSec(sec)}`);
  };
  tickPre();
  if (_collectElapsedTimer) clearInterval(_collectElapsedTimer);
  _collectElapsedTimer = setInterval(tickPre, 1000);
  const cr = await fetch(apiUrl('api/collect'), {
    method:'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force_full: !!forceFull }),
  }).catch(()=>null);
  if (cr && cr.ok) _dashIsCollecting = true;
  _prevCollecting = true;
  pollCollect();
}

function triggerCollectFull() {
  return triggerCollect(true);
}
