// Collect status bar, pollCollect, slow-top list, triggerCollect (shared timers with dashboard.live.js).
// Load after dashboard.load-summary.js, before dashboard.js (shim / index comments).

// ─────────────────────────────────────────────────────────────────────────────
// Collection status bar
// ─────────────────────────────────────────────────────────────────────────────
let _collectInterval = 300, _lastCollectedAt = null, _ticker = null;
/** True while server reports collect in progress — used to avoid flashing empty tables on transient snapshot gaps. */
let _dashIsCollecting = false;
let _liveMode = false;
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
  if (_prevCollecting && !state.is_collecting) refreshAll();
  _prevCollecting = state.is_collecting;
}

async function loadCollectSlowTop() {
  const now = Date.now();
  if (now - _collectLogsSlowPollTs < 2500) return;
  _collectLogsSlowPollTs = now;
  const box = document.getElementById('collectslow-box');
  if (!box) return;
  const res = await fetch(apiUrl('api/collect/slow?limit=10')).catch(()=>null);
  if (!res || !res.ok) return;
  const data = await res.json().catch(()=>null);
  const items = (data && data.items) || [];
  if (!items.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div style="font-size:.75rem;color:var(--muted);font-weight:700;padding:.35rem 1rem .1rem">Top slow jobs</div>` +
    items.map(it => {
      const ms = Number(it.elapsed_ms || 0);
      const kind = String(it.kind || '');
      const inst = String(it.instance || '');
      const job  = String(it.job || '');
      const b = it.build != null ? `#${it.build}` : '';
      return `<div style="padding:.25rem 1rem;border-top:1px solid var(--border);display:flex;gap:.5rem;align-items:center">
        <span style="min-width:5.5rem;font-weight:800;color:${ms>=15000?'#ef4444':ms>=8000?'#f59e0b':'#93c5fd'}">${ms}ms</span>
        <span style="min-width:4.2rem;color:var(--muted)">${_escHtml(kind)}</span>
        <span style="min-width:10rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_escHtml(inst)}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_escHtml(job)} <span style="color:var(--muted)">${_escHtml(b)}</span></span>
      </div>`;
    }).join('');
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
  const forceFull = !!document.getElementById('collect-full')?.checked;
  const cr = await fetch(apiUrl('api/collect'), {
    method:'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force_full: forceFull }),
  }).catch(()=>null);
  if (cr && cr.ok) _dashIsCollecting = true;
  _prevCollecting = true;
  pollCollect();
}
