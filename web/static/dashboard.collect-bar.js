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

// ─────────────────────────────────────────────────────────────────────────────
// Slow ops (paged + details modal)
// ─────────────────────────────────────────────────────────────────────────────
let _collectSlowOffset = 0;
let _collectSlowTotal = 0;
let _collectSlowHasMore = false;
let _collectSlowLoading = false;
let _collectSlowItems = [];
let _collectSlowLastRenderTs = 0;
let _collectSlowActive = null;

function _slowFmtTitle(it) {
  const ms = Number(it.elapsed_ms || 0);
  const kind = String(it.kind || '');
  const inst = String(it.instance || '');
  const job = String(it.job || '');
  const b = it.build != null ? `#${it.build}` : '';
  return `${ms}ms · ${kind} · ${inst} · ${job} ${b}`.trim();
}

function closeSlowOpModal() {
  const ov = document.getElementById('slowop-modal');
  if (!ov) return;
  ov.classList.remove('open');
  ov.setAttribute('aria-hidden', 'true');
  _collectSlowActive = null;
}

function openSlowOpModal(it) {
  const ov = document.getElementById('slowop-modal');
  const pre = document.getElementById('slowop-modal-pre');
  const sub = document.getElementById('slowop-modal-sub');
  if (!ov || !pre) return;
  _collectSlowActive = it || null;
  if (sub) sub.textContent = it ? _slowFmtTitle(it) : '';
  try {
    pre.textContent = it ? JSON.stringify(it, null, 2) : '';
  } catch {
    pre.textContent = String(it || '');
  }
  ov.classList.add('open');
  ov.setAttribute('aria-hidden', 'false');
}

async function copySlowOpDetails() {
  if (!_collectSlowActive) return;
  const txt = (() => {
    try { return JSON.stringify(_collectSlowActive, null, 2); } catch { return String(_collectSlowActive); }
  })();
  try {
    await navigator.clipboard.writeText(txt);
    showToast(t('dash.copy_log_toast'), 'ok');
  } catch {
    showToast(t('dash.copy_log_fail'), 'warn');
  }
}
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
  // Reset collect log session when a new collect starts.
  const cid = state && state.started_at ? String(state.started_at) : '';
  if (state && state.is_collecting && cid && cid !== _collectLogsLastCollectId) {
    _collectLogsLastCollectId = cid;
    _collectLogsWarn = 0; _collectLogsErr = 0; _collectLogsInstances = new Set();
    _collectLogsOffset = 0; _collectLogsTotal = 0;
    const pre = document.getElementById('collectlog-pre');
    if (pre) pre.innerHTML = '';
    const w = document.getElementById('collectlog-warn');
    const e = document.getElementById('collectlog-err');
    const cnt = document.getElementById('collectlog-count');
    if (w) w.textContent = '0 warn';
    if (e) e.textContent = '0 err';
    if (cnt) cnt.textContent = '0';
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

async function loadCollectSlowTop() {
  const now = Date.now();
  if (now - _collectLogsSlowPollTs < 2500) return;
  _collectLogsSlowPollTs = now;
  const box = document.getElementById('collectslow-box');
  if (!box) return;
  if (_collectSlowLoading) return;

  // First paint resets list; subsequent calls can append pages via scroll.
  if (now - _collectSlowLastRenderTs > 10000) {
    _collectSlowOffset = 0;
    _collectSlowItems = [];
    _collectSlowTotal = 0;
    _collectSlowHasMore = false;
    box.scrollTop = 0;
    box.innerHTML = '';
  }

  const limit = 30;
  _collectSlowLoading = true;
  const res = await fetch(apiUrl(`api/collect/slow?limit=${limit}&offset=${_collectSlowOffset}`)).catch(()=>null);
  _collectSlowLoading = false;
  if (!res || !res.ok) return;
  const data = await res.json().catch(()=>null);
  const items = (data && data.items) || [];
  _collectSlowTotal = Number((data && data.total) || 0) || 0;
  _collectSlowHasMore = !!(data && data.has_more);

  if (!_collectSlowItems.length) {
    box.innerHTML = `<div style="font-size:.75rem;color:var(--muted);font-weight:700;padding:.35rem 1rem .1rem">${_escHtml(t('dash.collect_slow_title'))}</div>`;
    box.addEventListener('scroll', () => {
      const nearBottom = (box.scrollTop + box.clientHeight) >= (box.scrollHeight - 40);
      if (nearBottom && _collectSlowHasMore && !_collectSlowLoading) {
        loadCollectSlowTop();
      }
    }, { passive: true });
  }

  if (!items.length) {
    _collectSlowLastRenderTs = now;
    return;
  }

  const startIdx = _collectSlowItems.length;
  _collectSlowItems.push(...items);
  _collectSlowOffset = _collectSlowItems.length;

  const rowsHtml = items.map((it, i) => {
    const idx = startIdx + i;
    const ms = Number(it.elapsed_ms || 0);
    const kind = String(it.kind || '');
    const inst = String(it.instance || '');
    const job  = String(it.job || '');
    const b = it.build != null ? `#${it.build}` : '';
    return `<div class="collectslow-row" data-idx="${idx}" style="padding:.25rem 1rem;border-top:1px solid var(--border);display:flex;gap:.5rem;align-items:center;cursor:pointer" title="${_escHtml(_slowFmtTitle(it))}">
      <span style="min-width:5.5rem;font-weight:800;color:${ms>=15000?'#ef4444':ms>=8000?'#f59e0b':'#93c5fd'}">${ms}ms</span>
      <span style="min-width:4.2rem;color:var(--muted)">${_escHtml(kind)}</span>
      <span class="collectslow-inst" style="min-width:10rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_escHtml(inst)}">${_escHtml(inst)}</span>
      <span class="collectslow-job" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_escHtml(job)} ${_escHtml(b)}">${_escHtml(job)} <span style="color:var(--muted)">${_escHtml(b)}</span></span>
    </div>`;
  }).join('');

  box.insertAdjacentHTML('beforeend', rowsHtml);
  // Attach click handler once (event delegation)
  if (!box.dataset.boundClicks) {
    box.dataset.boundClicks = '1';
    box.addEventListener('click', (ev) => {
      const row = ev.target && ev.target.closest ? ev.target.closest('.collectslow-row') : null;
      if (!row) return;
      const idx = parseInt(row.getAttribute('data-idx') || '-1', 10);
      const it = (idx >= 0 && idx < _collectSlowItems.length) ? _collectSlowItems[idx] : null;
      if (it) openSlowOpModal(it);
    });
  }
  _collectSlowLastRenderTs = now;
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

async function triggerCollect() {
  if (_ticker) { clearInterval(_ticker); _ticker = null; }
  document.getElementById('btn-collect').disabled = true;
  _collectStartedAt = Date.now();
  document.getElementById('cdot').className = 'dot collecting';
  const tickPre = () => {
    const sec = Math.floor((Date.now() - _collectStartedAt) / 1000);
    _setCollectLines(t('dash.collecting'), `${t('dash.collect_elapsed')}: ${fmtSec(sec)}`);
  };
  tickPre();
  if (_collectElapsedTimer) clearInterval(_collectElapsedTimer);
  _collectElapsedTimer = setInterval(tickPre, 1000);
  const cr = await fetch(apiUrl('api/collect'), {
    method:'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force_full: true }),
  }).catch(()=>null);
  if (cr && cr.ok) _dashIsCollecting = true;
  _prevCollecting = true;
  pollCollect();
}
