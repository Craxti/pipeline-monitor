// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const badge = (s) => {
  s = (s||'').toLowerCase();
  const cls = ['success','passed','up'].includes(s) ? 'b-ok'
    : ['failure','failed','error','down'].includes(s) ? 'b-fail'
    : ['unstable','degraded','skipped'].includes(s) ? 'b-warn'
    : ['running','pending'].includes(s) ? 'b-info'
    : 'b-dim';
  const code = ['success','passed','up'].includes(s) ? 'OK'
    : ['failure','failed','error','down'].includes(s) ? 'FAIL'
    : ['unstable','degraded','skipped'].includes(s) ? '~'
    : ['running','pending'].includes(s) ? '…'
    : '·';
  return `<span class="b ${cls}" role="status" data-status="${_svgTitleAttr(s)}"><span class="b-code" aria-hidden="true">${code}</span>${esc(s)}</span>`;
};
const fmt = (v) => {
  if (!v) return '—';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v).replace('T', ' ').slice(0, 16);
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch { return '—'; }
};
function fmtUtcIso(v) {
  if (!v) return '—';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v).slice(0, 19);
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' ' + t('time.utc_suffix');
  } catch { return '—'; }
}
const dur = (s) => {
  if (s == null || Number.isNaN(Number(s))) return '—';
  const x = Number(s);
  if (x < 60) return `${Math.round(x)}s`;
  return `${Math.floor(x / 60)}m ${Math.round(x % 60)}s`;
};
// Escaping helpers:
// - esc(): safe for HTML text nodes (also safe-ish in attributes; use _svgTitleAttr for title="" specifically)
// Note: we escape quotes too because this project often interpolates values into HTML attributes.
const esc  = s => s == null ? '—' : String(s)
  .replace(/&/g,'&amp;')
  .replace(/</g,'&lt;')
  .replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;')
  .replace(/'/g,'&#39;');

function safeUrl(u) {
  // Allow only http(s) URLs; otherwise return empty string.
  try {
    const s = String(u || '').trim();
    if (!s) return '';
    const x = new URL(s, window.location.origin);
    if (x.protocol !== 'http:' && x.protocol !== 'https:') return '';
    return x.href;
  } catch {
    return '';
  }
}
const fmtSec = s => s >= 60 ? `${Math.floor(s/60)}m ${s%60}s` : `${s}s`;

function _cssVar(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || '#94a3b8';
}
function _hexToRgba(hex, a) {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return `rgba(148,163,184,${a})`;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
function _statusColorHex(status) {
  const k = String(status || '').toLowerCase();
  const map = {
    success: '--st-success', failure: '--st-failure', running: '--st-running', unstable: '--st-unstable',
    aborted: '--st-unknown', passed: '--st-success', failed: '--st-failure', error: '--st-failure',
    down: '--st-failure', up: '--st-success', degraded: '--st-unstable', skipped: '--st-unknown',
  };
  return _cssVar(map[k] || '--st-unknown');
}

function _setCollectLines(main, sub) {
  const m = document.getElementById('collect-line-main');
  const s = document.getElementById('collect-line-sub');
  if (m) m.textContent = main || '';
  if (s) {
    if (sub) { s.textContent = sub; s.style.display = ''; }
    else { s.textContent = ''; s.style.display = 'none'; }
  }
}

/** Screen reader announcements (toasts also mirror here). */
function srAnnounce(msg, mode) {
  const id = mode === 'assertive' ? 'sr-assertive' : 'sr-polite';
  const el = document.getElementById(id);
  if (!el || !msg) return;
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = String(msg); });
}

/** Copy `job #build` (or job only) for tickets / chat — used from builds tables. */
function copyBuildRef(ev, jobName, buildNum) {
  try {
    if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
  } catch { /* ignore */ }
  const j = String(jobName || '').trim();
  const n = buildNum != null && buildNum !== '' ? String(buildNum).trim() : '';
  const line = j && n ? `${j} #${n}` : (j || n);
  if (!line) return;
  (async () => {
    try {
      await navigator.clipboard.writeText(line);
      showToast(tf('dash.copy_id_toast', { line }), 'ok');
    } catch {
      showToast(t('dash.copy_id_fail'), 'err');
    }
  })();
}

function emptyStateActionsHtml() {
  return `<div class="empty-actions">
    <button type="button" class="btn" onclick="triggerCollect()">${esc(t('dash.collect'))}</button>
    <a href="settings" class="btn btn-ghost">${esc(t('dash.settings'))}</a>
  </div>`;
}

/** API URL относительно текущей страницы (работает за nginx с префиксом /monitor/ и т.п.; не используйте ведущий /api). */
function apiUrl(path) {
  const p = path.startsWith('/') ? path.slice(1) : path;
  const base = window.location.origin + window.location.pathname;
  return new URL(p, base).href;
}

/** Per-job analytics from /api/meta (for starred rows). */
let _jobAnalytics = {};

function _fmtBuildContext(analytics) {
  const a = analytics || {};
  const parts = [];
  if (a.last_success_build_number != null && a.last_success_build_number !== '') {
    parts.push(`${t('context.last_ok')}#${a.last_success_build_number}`);
  }
  if (a.consecutive_failures > 0) {
    parts.push(`${a.consecutive_failures}↓`);
  }
  return parts.length ? parts.join(' · ') : '—';
}

function updateFreshnessBar(meta) {
  const el = document.getElementById('freshness-bar');
  if (!el || !meta) return;
  const s = meta.snapshot || {};
  const c = meta.collect || {};
  if (!s.collected_at) {
    if (c.last_error) {
      el.className = 'freshness-bar fresh-err';
      el.style.display = 'block';
      el.innerHTML = `<span class="fresh-warn">${t('fresh.collect_err')}: ${esc(String(c.last_error).slice(0, 240))}</span>`;
    } else {
      el.style.display = 'none';
    }
    return;
  }
  const age = s.age_seconds != null ? Math.round(s.age_seconds) : '—';
  const localTs = fmt(s.collected_at);
  const utcTs = fmtUtcIso(s.collected_at);
  let extra = '';
  if (c.last_error) {
    el.className = 'freshness-bar fresh-err';
    extra = ` <span class="fresh-warn">(${t('fresh.collect_err')}: ${esc(String(c.last_error).slice(0, 160))})</span>`;
  } else if (s.stale) {
    el.className = 'freshness-bar fresh-stale';
    extra = ` <span class="fresh-warn">(${t('fresh.stale_warn')})</span>`;
  } else {
    el.className = 'freshness-bar';
  }
  el.style.display = 'block';
  el.innerHTML = `${t('fresh.snapshot_label')}: <strong>${esc(localTs)}</strong> <span class="utc-note">(${esc(t('fresh.snapshot_utc'))}: ${esc(utcTs)})</span> · ${t('fresh.age')}: <strong>${age}s</strong>${extra}`;
}

function updateCorrelationHint(meta) {
  const el = document.getElementById('correlation-hint');
  if (!el || !meta || !meta.correlation) return;
  const { pipelines_started_last_hour: p, service_events_last_hour: s } = meta.correlation;
  if (!p && !s) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.textContent = t('correlation.line').replace('{{p}}', String(p)).replace('{{s}}', String(s));
}

function updateTopStatusBar(metaObj, summaryObj, nFail, nTFail, nDown) {
  const collectTxt = document.getElementById('top-collect-txt');
  const collectDot = document.getElementById('top-collect-dot');
  const ageTxt = document.getElementById('top-age-txt');
  const ageDot = document.getElementById('top-age-dot');
  const redTxt = document.getElementById('top-red-txt');
  const srcTxt = document.getElementById('top-src-txt');
  const srcDot = document.getElementById('top-src-dot');

  const c = (metaObj && metaObj.collect) ? metaObj.collect : {};
  const s = (metaObj && metaObj.snapshot) ? metaObj.snapshot : {};

  const collecting = !!c.is_collecting;
  const lastErr = c.last_error ? String(c.last_error) : '';
  if (collectTxt) collectTxt.textContent = collecting ? 'Collect: running' : (lastErr ? 'Collect: error' : 'Collect: ok');
  if (collectDot) collectDot.className = 'topdot ' + (collecting ? 'warn' : (lastErr ? 'err' : 'ok'));

  const ageSec = (s && s.age_seconds != null) ? Number(s.age_seconds) : null;
  const stale = !!(s && s.stale);
  if (ageSec == null || isNaN(ageSec)) {
    _topAgeBaseSec = null;
    _topAgeBaseTs = 0;
    _topAgeStale = false;
    if (ageTxt) ageTxt.textContent = 'Age: —';
    if (ageDot) ageDot.className = 'topdot';
  } else {
    _topAgeBaseSec = Math.max(0, Math.round(ageSec));
    _topAgeBaseTs = Date.now();
    _topAgeStale = stale;
    if (ageTxt) ageTxt.textContent = `Age: ${_topAgeBaseSec}s`;
    if (ageDot) ageDot.className = 'topdot ' + (stale ? 'warn' : 'ok');
    if (!_topAgeTimer) {
      _topAgeTimer = setInterval(() => {
        if (_topAgeBaseSec == null || !_topAgeBaseTs) return;
        const extra = Math.max(0, Math.floor((Date.now() - _topAgeBaseTs) / 1000));
        const val = _topAgeBaseSec + extra;
        const tEl = document.getElementById('top-age-txt');
        if (tEl) tEl.textContent = `Age: ${val}s`;
        const dEl = document.getElementById('top-age-dot');
        if (dEl) dEl.className = 'topdot ' + (_topAgeStale ? 'warn' : 'ok');
      }, 1000);
    }
  }

  if (redTxt) redTxt.textContent = `Builds: ${nFail || 0} · Tests: ${nTFail || 0} · Svcs: ${nDown || 0}`;

  const ih = (summaryObj && Array.isArray(summaryObj.instance_health)) ? summaryObj.instance_health
    : (metaObj && Array.isArray(metaObj.instance_health)) ? metaObj.instance_health
    : [];
  const down = ih.filter((x) => x && x.ok === false).length;
  const total = ih.length;
  if (srcTxt) srcTxt.textContent = total ? `Sources: ${total - down}/${total} ok` : 'Sources: —';
  if (srcDot) srcDot.className = 'topdot ' + (total ? (down ? 'warn' : 'ok') : '');
}

function initEventSource() {
  if (typeof EventSource === 'undefined') return;
  try {
    // Ensure only one stream is active.
    try { if (_eventSource) _eventSource.close(); } catch { /* ignore */ }
    _eventSource = new EventSource(apiUrl('api/stream/events'));
    _eventSource.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.type === 'collect_done') {
          showToast(t('dash.collect_done_toast'), 'ok');
          // Defer so the SSE handler returns quickly; coalesce with pollCollect via refreshAll single-flight.
          setTimeout(() => {
            refreshAll();
            pollCollect();
          }, 0);
        }
      } catch { /* ignore */ }
    };
    _eventSource.onerror = () => { try { _eventSource.close(); } catch (e) { /* ignore */ } };
  } catch { /* ignore */ }
}

let _lastSit = { failB: 0, failT: 0, downS: 0 };
let _uptimeData = {}; // service name → [{date, status}]
let _lastBuildsForIc = [];
let _lastIncidentReasons = [];
let _lastIcReasonFacts = null;
let _lastIncidentSeverity = 'ok';

function icReasonLines() {
  const f = _lastIcReasonFacts;
  if (!f) return [];
  const reasons = [];
  if (f.sd > 0) reasons.push(tf('icenter.reason_down_svcs', { n: f.sd }));
  if (f.critBuildFails) reasons.push(t('icenter.reason_crit_build'));
  if (f.ft > 0) reasons.push(tf('icenter.reason_failed_tests', { n: f.ft }));
  if (f.fb > 0) reasons.push(tf('icenter.reason_failed_builds', { n: f.fb }));
  if (f.unstable) reasons.push(t('icenter.reason_unstable'));
  if (f.peLen > 0) reasons.push(tf('icenter.reason_partial', { n: f.peLen }));
  if (f.stale) reasons.push(t('icenter.reason_stale'));
  return reasons;
}

function severityLabelForRunbook() {
  const m = { ok: 'icenter.severity_ok', critical: 'icenter.severity_critical', high: 'icenter.severity_high', warn: 'icenter.severity_warn' };
  const key = m[_lastIncidentSeverity];
  return key ? t(key) : _lastIncidentSeverity;
}

function refreshRunbookModalBody() {
  const lines = icReasonLines();
  const sub = document.getElementById('runbook-sub');
  if (sub) {
    const tail = lines.length ? lines.join(' · ') : t('icenter.runbook_no_signals');
    sub.textContent = `${t('icenter.runbook_severity_label')} ${severityLabelForRunbook()} · ${tail}`;
  }
  const ul = document.getElementById('runbook-reasons');
  if (ul) {
    ul.innerHTML = '';
    const items = lines.length ? lines : [t('icenter.runbook_no_signals')];
    items.slice(0, 8).forEach((txt) => {
      const li = document.createElement('li');
      li.textContent = String(txt);
      ul.appendChild(li);
    });
  }
}

function refreshIncidentReasonsI18n() {
  if (!_lastIcReasonFacts) return;
  _lastIncidentReasons = icReasonLines();
  const rEl = document.getElementById('ic-reasons');
  if (rEl) {
    if (_lastIncidentReasons.length) {
      rEl.style.display = 'block';
      rEl.textContent = `${t('icenter.why_prefix')} ${_lastIncidentReasons.slice(0, 4).join(' · ')}`;
    } else {
      rEl.style.display = 'none';
      rEl.textContent = '';
    }
  }
  const rb = document.getElementById('runbook-modal');
  if (rb && rb.classList.contains('open')) refreshRunbookModalBody();
}

let _logModalPrevFocus = null;
let _collectAutoRefreshTs = 0;
let _collectLogsOffset = 0;
let _collectLogsTotal = 0;
let _collectLogsPollTs = 0;
let _collectLogsWarn = 0;
let _collectLogsErr = 0;
let _collectLogsInstances = new Set();
let _collectLogsLastCollectId = '';
let _collectLogsSlowPollTs = 0;

const DASH_TABS = ['overview', 'builds', 'tests', 'services', 'trends', 'incidents', 'logs'];
let _dashTab = 'overview';

function setDashboardTab(name, opts) {
  opts = opts || {};
  const skipUrl = opts.skipUrl;
  const skipStore = opts.skipStore;
  if (!DASH_TABS.includes(name)) name = 'overview';
  _dashTab = name;
  DASH_TABS.forEach((id) => {
    const panel = document.getElementById('tab-panel-' + id);
    if (panel) panel.hidden = (id !== name);
  });
  document.querySelectorAll('#dash-page-tabs .dash-tab').forEach((btn) => {
    const sel = btn.dataset.tab === name;
    btn.setAttribute('aria-selected', sel ? 'true' : 'false');
    btn.classList.toggle('active', sel);
  });
  try {
    if (!skipStore) localStorage.setItem('cimon-dash-tab', name);
  } catch { /* ignore */ }
  if (!skipUrl) _writeURLFilters();
  if (name === 'trends') {
    requestAnimationFrame(() => { _trendsCharts.forEach((c) => c && c.resize()); });
  }
  // Prevent stale panel requests from overriding current UI.
  if (name !== 'builds') abortFetchKey('builds');
  if (name !== 'tests') abortFetchKey('tests');
  if (name !== 'tests') abortFetchKey('failures');
  if (name !== 'services') abortFetchKey('services');
  if (name !== 'trends') abortFetchKey('trends');
}

function goToInTab(tab, elId) {
  setDashboardTab(tab);
  requestAnimationFrame(() => document.getElementById(elId)?.scrollIntoView({ behavior: 'smooth' }));
}

function runbookFocusBuildFailures() {
  goToInTab('builds', 'panel-builds');
  const el = document.getElementById('f-bstatus');
  if (el) el.value = 'failure';
  resetBuilds();
}

function runbookFocusTestFailures() {
  goToInTab('tests', 'panel-tests');
  const el = document.getElementById('f-tstatus');
  if (el) el.value = 'failed';
  resetTests();
}

function runbookFocusServicesProblems() {
  goToInTab('services', 'panel-svcs');
  const cb = document.getElementById('sv-problems-only');
  if (cb) cb.checked = true;
  toggleSvcProblemsOnly(true);
}

const _DASH_ACTION_PASS_EL = new Set(['loadTrends', 'setTrendsSize']);

function initDashDelegatedActions() {
  // Capture phase so clicks inside modals still reach us even when `[role=dialog]`
  // stops propagation on bubble (see listener below).
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-dash-action]');
    if (!el) return;
    const name = el.getAttribute('data-dash-action');
    const fn = window[name];
    if (typeof fn !== 'function') return;
    const raw = el.getAttribute('data-dash-args');
    if (raw != null && raw !== '') {
      let args;
      try {
        args = JSON.parse(raw);
      } catch {
        return;
      }
      if (!Array.isArray(args)) args = [args];
      if (_DASH_ACTION_PASS_EL.has(name)) fn(...args, el);
      else fn(...args);
      return;
    }
    fn(ev);
  }, true);

  document.querySelectorAll('[data-dash-overlay-dismiss]').forEach((overlay) => {
    overlay.addEventListener('click', (ev) => {
      if (ev.target !== overlay) return;
      const fnName = overlay.getAttribute('data-dash-overlay-dismiss');
      const cb = fnName && window[fnName];
      if (typeof cb === 'function') cb();
    });
  });
  document.querySelectorAll('.modal-overlay [role="dialog"]').forEach((card) => {
    card.addEventListener('click', (e) => e.stopPropagation());
  });
}

/** Map / builds / tests / services / trends / collect-log / log-view / chat input — was inline on* in index.html */
function initDashFormControlBindings() {
  const byId = (id) => document.getElementById(id);

  const mapQ = byId('map-q');
  if (mapQ) mapQ.addEventListener('input', () => { debounce(renderStatusMapFromState, 200)(); });
  [
    'map-only-critical',
    'map-st-failure',
    'map-st-running',
    'map-st-unstable',
    'map-st-success',
    'map-st-unknown',
  ].forEach((id) => {
    const el = byId(id);
    if (el) el.addEventListener('change', () => { renderStatusMapFromState(); });
  });

  ['f-source', 'f-instance', 'f-bstatus'].forEach((id) => {
    const el = byId(id);
    if (el) el.addEventListener('change', resetBuilds);
  });
  const fJob = byId('f-job');
  if (fJob) fJob.addEventListener('input', () => { debounce(resetBuilds, 400)(); });

  const fFname = byId('f-fname');
  if (fFname) fFname.addEventListener('input', () => { debounce(resetFailures, 400)(); });
  const fFsuite = byId('f-fsuite');
  if (fFsuite) fFsuite.addEventListener('input', () => { debounce(resetFailures, 400)(); });

  const fTsource = byId('f-tsource');
  if (fTsource) {
    fTsource.addEventListener('change', () => {
      resetFailures();
      resetTests();
      updateTestsExportLinks();
      updateFailuresExportLinks();
    });
  }
  const fTstatus = byId('f-tstatus');
  if (fTstatus) fTstatus.addEventListener('change', resetTests);
  const fTname = byId('f-tname');
  if (fTname) fTname.addEventListener('input', () => { debounce(resetTests, 400)(); });
  const fTsuite = byId('f-tsuite');
  if (fTsuite) fTsuite.addEventListener('input', () => { debounce(resetTests, 400)(); });

  const fSvstatus = byId('f-svstatus');
  if (fSvstatus) fSvstatus.addEventListener('change', resetServices);
  const svProb = byId('sv-problems-only');
  if (svProb) {
    svProb.addEventListener('change', (e) => {
      const t = e.target;
      if (t && 'checked' in t) toggleSvcProblemsOnly(!!t.checked);
    });
  }

  const trSrc = byId('trends-source');
  if (trSrc) trSrc.addEventListener('change', () => { onTrendsSourceChange(trSrc); });
  const trSm = byId('trends-smooth');
  if (trSm) trSm.addEventListener('change', () => { onTrendsSmoothChange(trSm); });
  const trTop = byId('trends-topn');
  if (trTop) {
    trTop.addEventListener('change', () => { onTrendsTopNChange(trTop); });
    trTop.addEventListener('blur', () => { onTrendsTopNChange(trTop); });
  }
  ['trends-inst-builds', 'trends-inst-tests', 'trends-inst-top', 'trends-inst-svcs'].forEach((id) => {
    const el = byId(id);
    if (el) el.addEventListener('change', () => {
      try {
        if (id === 'trends-inst-svcs') localStorage.setItem('cimon-trends-inst-svcs', el.value || '');
      } catch { /* ignore */ }
      renderTrendsFromCache();
    });
  });

  ['f-cl-level', 'f-cl-inst', 'f-cl-phase'].forEach((id) => {
    const el = byId(id);
    if (el) el.addEventListener('change', resetCollectLogs);
  });
  const clJob = byId('f-cl-job');
  if (clJob) clJob.addEventListener('input', () => { debounce(resetCollectLogs, 300)(); });
  const clQ = byId('f-cl-q');
  if (clQ) clQ.addEventListener('input', () => { debounce(resetCollectLogs, 300)(); });

  const logS = byId('log-search-input');
  if (logS) logS.addEventListener('input', (e) => { _onLogSearch(e.target && 'value' in e.target ? e.target.value : ''); });
  const logRx = byId('log-search-regex');
  if (logRx) logRx.addEventListener('change', _onLogRegexToggle);

  const chatIn = byId('chat-input');
  if (chatIn) {
    chatIn.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendChat();
      }
    });
  }
}

function refreshActivePanel() {
  if (_dashTab === 'overview') { loadSummary(); return; }
  if (_dashTab === 'builds') { resetBuilds(); return; }
  if (_dashTab === 'tests') { resetFailures(); resetTests(); return; }
  if (_dashTab === 'services') { resetServices(); return; }
  if (_dashTab === 'trends') { loadTrends(_trendsViewDays, null); return; }
  if (_dashTab === 'incidents') { loadSummary(); return; }
  if (_dashTab === 'logs') { loadCollectLogs(); loadCollectSlowTop(); return; }
}

function initDashboardTabs() {
  const root = document.getElementById('dash-page-tabs');
  if (!root) return;
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.dash-tab[data-tab]');
    if (!btn) return;
    setDashboardTab(btn.dataset.tab);
  });
}

function applyIncidentFilter(inc) {
  toggleTimeFilter(24);
  const fs = document.getElementById('f-bstatus');
  const fj = document.getElementById('f-job');
  if (fs) fs.value = 'failure';
  if (fj) fj.value = (inc.jobs && inc.jobs.length === 1) ? inc.jobs[0] : '';
  resetBuilds();
  goToInTab('builds', 'panel-builds');
}

function _icTsMs(v) {
  if (!v) return NaN;
  try {
    const d = new Date(String(v));
    const ms = d.getTime();
    return isNaN(ms) ? NaN : ms;
  } catch { return NaN; }
}

function _icShort(s, n=140) {
  s = String(s || '').trim();
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function _flashTableRow(tr) {
  if (!tr) return;
  try {
    tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch { /* ignore */ }
  tr.classList.add('row-flash-highlight');
  window.setTimeout(() => { try { tr.classList.remove('row-flash-highlight'); } catch { /* ignore */ } }, 3000);
}

function _flashBuildRowForJob(jobName, buildNumber) {
  const wantJob = String(jobName || '');
  const wantBn = buildNumber != null && buildNumber !== '' ? String(buildNumber) : null;
  const pick = () => {
    const rows = document.querySelectorAll('#tbody-builds tr[data-job]');
    let hit = null;
    rows.forEach((tr) => {
      if (tr.classList.contains('empty-row') || tr.classList.contains('load-more-row') || tr.classList.contains('src-group-row')) return;
      let jn = '';
      try { jn = decodeURIComponent(tr.getAttribute('data-job') || ''); } catch { return; }
      if (jn !== wantJob) return;
      if (wantBn) {
        const numCell = tr.querySelector('.col-pin-num');
        const txt = (numCell && numCell.textContent) ? numCell.textContent : '';
        if (!txt.includes(wantBn)) return;
      }
      hit = tr;
    });
    return hit;
  };
  const run = () => {
    const tr = pick();
    if (tr) { _flashTableRow(tr); return true; }
    return false;
  };
  if (run()) return;
  let n = 0;
  const iv = window.setInterval(() => {
    n++;
    if (run() || n > 50) window.clearInterval(iv);
  }, 160);
}

function _flashTestRowByName(testName, suite) {
  const want = String(testName || '').trim();
  const su = String(suite || '').trim();
  const pick = () => {
    const rows = document.querySelectorAll('#tbody-tests tr');
    for (const tr of rows) {
      if (tr.classList.contains('empty-row') || tr.classList.contains('load-more-row')) continue;
      const tds = tr.querySelectorAll('td');
      if (!tds.length) continue;
      const t0 = (tds[0] && tds[0].textContent) ? tds[0].textContent.trim() : '';
      if (su && t0 && !t0.includes(su) && !su.includes(t0.split(/\s+/)[0])) continue;
      if (want && t0 && !t0.includes(want)) continue;
      if (want && t0 === want) return tr;
      if (want && t0.includes(want)) return tr;
    }
    return null;
  };
  const run = () => {
    const tr = pick();
    if (tr) { _flashTableRow(tr); return true; }
    return false;
  };
  if (run()) return;
  let n = 0;
  const iv = window.setInterval(() => {
    n++;
    if (run() || n > 50) window.clearInterval(iv);
  }, 160);
}

function _flashSvcRowByName(name) {
  const want = String(name || '').trim();
  const pick = () => {
    const rows = document.querySelectorAll('#tbody-svcs tr');
    for (const tr of rows) {
      if (tr.classList.contains('empty-row') || tr.classList.contains('load-more-row')) continue;
      const strong = tr.querySelector('td:first-child strong');
      const nm = strong ? strong.textContent.trim() : '';
      if (nm && nm === want) return tr;
    }
    return null;
  };
  const run = () => {
    const tr = pick();
    if (tr) { _flashTableRow(tr); return true; }
    return false;
  };
  if (run()) return;
  let n = 0;
  const iv = window.setInterval(() => {
    n++;
    if (run() || n > 50) window.clearInterval(iv);
  }, 160);
}

function _icAppendEventRow(wrap, ev) {
  if (!wrap || !ev) return;
  const row = document.createElement('div');
  row.className = `ic-ev ${ev.cls || ''}`.trim();

  const time = document.createElement('div');
  time.className = 'ic-ev-time';
  time.textContent = fmt(ev.tsIso || '');

  const main = document.createElement('div');
  main.className = 'ic-ev-main';
  const title = document.createElement('div');
  title.className = 'ic-ev-title';

  const kind = document.createElement('span');
  kind.className = 'ic-ev-kind';
  kind.textContent = ev.kind || '';

  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'ic-ev-link';
  link.textContent = ev.name || '—';
  if (ev.title) link.title = ev.title;
  if (typeof ev.onClick === 'function') link.addEventListener('click', ev.onClick);

  title.append(kind, link);

  const desc = document.createElement('div');
  desc.className = 'ic-ev-desc';
  desc.textContent = ev.desc || '';

  main.append(title);
  if (ev.desc) main.append(desc);

  row.append(time, main);
  wrap.appendChild(row);
}

function renderIncidentCards(snap) {
  const wrap = document.getElementById('ic-cards');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!snap || snap.error) { wrap.style.display = 'none'; return; }

  const builds = Array.isArray(snap.builds) ? snap.builds : [];
  const tests  = Array.isArray(snap.tests) ? snap.tests : [];
  const svcs   = Array.isArray(snap.services) ? snap.services : [];

  const events = [];

  // Services down → event
  svcs.forEach((s) => {
    if (!s || String(s.status || '').toLowerCase() !== 'down') return;
    const ts = _icTsMs(s.checked_at);
    events.push({
      ts,
      tsIso: s.checked_at || '',
      cls: 'ic-svc',
      kind: t('icenter.card_service'),
      name: String(s.name || '—'),
      desc: _icShort(s.detail || '', 160),
      title: String(s.detail || ''),
      onClick: () => {
        const cb = document.getElementById('sv-problems-only');
        if (cb) cb.checked = true;
        toggleSvcProblemsOnly(true);
        goToInTab('services', 'panel-svcs');
        window.requestAnimationFrame(() => _flashSvcRowByName(String(s.name || '')));
      },
    });
  });

  // Failed/unstable builds → event
  builds.forEach((b) => {
    if (!b || !(b.status === 'failure' || b.status === 'unstable')) return;
    const ts = _icTsMs(b.started_at);
    const st = String(b.status || '').toLowerCase();
    const num = (b.build_number != null && b.build_number !== '') ? ` #${b.build_number}` : '';
    const branch = b.branch ? ` · ${b.branch}` : '';
    events.push({
      ts,
      tsIso: b.started_at || '',
      cls: st === 'unstable' ? 'ic-warn' : 'ic-fail',
      kind: t('icenter.card_build'),
      name: `${String(b.job_name || '—')}${num}`,
      desc: _icShort(`${st}${branch}`, 160),
      title: b.url ? String(b.url) : '',
      onClick: () => {
        // Make the jump resilient: widen time window so the event is likely visible.
        _buildsHours = 168;
        document.querySelectorAll('.time-filter-btn').forEach((btn) => btn.classList.remove('active'));
        document.getElementById('tf-7d')?.classList.add('active');
        try { localStorage.setItem('cimon-builds-hours', String(_buildsHours)); } catch { /* ignore */ }
        goToInTab('builds', 'panel-builds');
        const fs = document.getElementById('f-bstatus');
        const fj = document.getElementById('f-job');
        const fsrc = document.getElementById('f-source');
        const finst = document.getElementById('f-instance');
        if (fsrc) fsrc.value = '';
        if (finst) finst.value = '';
        if (fs) fs.value = st;
        if (fj) fj.value = String(b.job_name || '');
        resetBuilds();
        window.requestAnimationFrame(() => _flashBuildRowForJob(b.job_name, b.build_number));
      },
    });
  });

  // Failed/error tests → event
  tests.forEach((trow) => {
    if (!trow) return;
    const st = String(trow.status || '').toLowerCase();
    if (!(st === 'failed' || st === 'error')) return;
    const ts = _icTsMs(trow.timestamp);
    const suite = String(trow.suite || '');
    const nm = String(trow.test_name || '—');
    events.push({
      ts,
      tsIso: trow.timestamp || '',
      cls: 'ic-test',
      kind: t('icenter.card_test'),
      name: suite ? `${suite} · ${nm}` : nm,
      desc: _icShort(trow.failure_message || '', 180),
      title: String(trow.failure_message || ''),
      onClick: () => {
        // Widen time window for tests too.
        _testsHours = 168;
        ['tf-t-6h','tf-t-24h','tf-t-7d'].forEach((id) => document.getElementById(id)?.classList.remove('active'));
        document.getElementById('tf-t-7d')?.classList.add('active');
        try { localStorage.setItem('cimon-tests-hours', String(_testsHours)); } catch { /* ignore */ }
        goToInTab('tests', 'panel-tests');
        const fs = document.getElementById('f-tstatus');
        const fn = document.getElementById('f-tname');
        const fsu = document.getElementById('f-tsuite');
        if (fs) fs.value = 'failed';
        if (fn) fn.value = nm;
        if (fsu) fsu.value = suite;
        resetTests();
        window.requestAnimationFrame(() => _flashTestRowByName(nm, suite));
      },
    });
  });

  // Sort: newest first; keep the list readable.
  events
    .filter((e) => e && !isNaN(e.ts))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 30)
    .forEach((ev) => _icAppendEventRow(wrap, ev));

  wrap.style.display = wrap.childElementCount ? 'flex' : 'none';
}

function renderIcTimeline(incidents) {
  const wrap = document.getElementById('ic-timeline');
  if (!wrap) return;
  if (!incidents || !incidents.length) {
    wrap.innerHTML = '';
    wrap.style.display = 'none';
    return;
  }
  const MAX = 12;
  // Persist expand/collapse across refreshes during the session.
  if (typeof window._icTlExpanded === 'undefined') window._icTlExpanded = false;
  const expanded = !!window._icTlExpanded;
  const shown = expanded ? incidents : incidents.slice(0, MAX);
  const more = Math.max(0, incidents.length - (expanded ? incidents.length : shown.length));
  wrap.style.display = 'block';
  wrap.innerHTML = `<div class="ic-tl-title">${esc(t('icenter.timeline_title'))}</div><div class="ic-tl-row">${
    shown.map((inc, i) => {
      const job = (inc && inc.jobs && inc.jobs[0]) ? String(inc.jobs[0]) : '';
      const short = job.length > 18 ? (job.slice(0, 18) + '…') : job;
      const title = job ? ` title="${_svgTitleAttr(job)}"` : '';
      return `<button type="button" class="ic-tl-seg" data-ic-tl="${i}"${title}>${esc(short || (String(inc.count || 1) + '×'))}</button>`;
    }).join('') + (incidents.length > MAX ? `<button type="button" class="ic-tl-seg" data-ic-tl-toggle style="color:var(--muted)">${expanded ? esc(t('icenter.tl_collapse')) : ('+' + more + ' ' + esc(t('icenter.tl_more')))}</button>` : '')
  }</div>`;
  shown.forEach((inc, i) => {
    wrap.querySelector(`[data-ic-tl="${i}"]`)?.addEventListener('click', () => applyIncidentFilter(inc));
  });
  const tg = wrap.querySelector('[data-ic-tl-toggle]');
  if (tg) {
    tg.addEventListener('click', () => {
      window._icTlExpanded = !window._icTlExpanded;
      renderIcTimeline(incidents);
    });
  }
}

function renderIncidentCenter(snap, summary, _metaObj) {
  const el = document.getElementById('incident-center');
  if (!el) return;
  if (!snap || snap.error) {
    el.style.display = 'none';
    return;
  }
  const builds = snap.builds || [];
  _lastBuildsForIc = builds;
  const c = (summary && summary.counts) || {};
  const fb = c.failed_builds != null ? c.failed_builds : builds.filter((b) => b.status === 'failure').length;
  const ft = c.failed_tests != null ? c.failed_tests : (snap.tests || []).filter((t) => ['failed', 'error'].includes(t.status)).length;
  const sd = c.services_down != null ? c.services_down : (snap.services || []).filter((s) => s.status === 'down').length;
  const pe = (summary && summary.partial_errors) || [];
  const stale = summary && summary.snapshot && summary.snapshot.stale;
  const collected = (summary && summary.snapshot && summary.snapshot.collected_at) || snap.collected_at || '';

  const hasIssue = fb > 0 || ft > 0 || sd > 0 || pe.length > 0 || stale;
  let sev = 'ok';
  let sevKey = 'severity_ok';
  // Severity policy:
  // - critical: down services OR failures in critical jobs/projects
  // - high:     any failed/unstable builds or failed tests (non-critical)
  // - warn:     partial errors / stale
  const critBuildFails = builds.some((b) => b.critical && (b.status === 'failure' || b.status === 'unstable'));
  const critJobs = new Set(builds.filter(b => b.critical).map(b => b.job_name));
  const critTestFails = (snap.tests || []).some((t) => (t.status === 'failed' || t.status === 'error') && critJobs.has(t.suite || ''));
  if (sd > 0 || critBuildFails || critTestFails) { sev = 'critical'; sevKey = 'severity_critical'; }
  else if (fb > 0 || ft > 0 || builds.some((b) => b.status === 'unstable')) { sev = 'high'; sevKey = 'severity_high'; }
  else if (pe.length > 0 || stale) { sev = 'warn'; sevKey = 'severity_warn'; }
  else if (!hasIssue) { sev = 'ok'; sevKey = 'severity_ok'; }
  _lastIncidentSeverity = sev;

  el.classList.remove('ic-critical', 'ic-high', 'ic-warn', 'ic-ok');
  el.classList.add(sev === 'critical' ? 'ic-critical' : sev === 'high' ? 'ic-high' : sev === 'warn' ? 'ic-warn' : 'ic-ok');

  const sevEl = document.getElementById('ic-sev');
  if (sevEl) {
    sevEl.className = 'ic-sev ' + (sev === 'ok' ? 'ok' : sev === 'critical' ? 'critical' : sev === 'high' ? 'high' : 'warn');
    sevEl.textContent = t('icenter.' + sevKey);
  }

  const meta = document.getElementById('ic-meta');
  if (meta) {
    let line = `${t('icenter.last_update')}: ${fmt(collected)}`;
    if (stale) line += ` — ${t('icenter.stale_note')}`;
    meta.textContent = line;
  }

  // Reasons (why this severity) — facts for i18n; strings rebuilt via icReasonLines()
  _lastIcReasonFacts = {
    sd,
    critBuildFails: !!critBuildFails,
    ft,
    fb,
    unstable: builds.some((b) => b.status === 'unstable'),
    peLen: pe.length,
    stale: !!stale,
  };
  const reasons = icReasonLines();
  _lastIncidentReasons = reasons;
  const rEl = document.getElementById('ic-reasons');
  if (rEl) {
    if (reasons.length) {
      rEl.style.display = 'block';
      rEl.textContent = `${t('icenter.why_prefix')} ${reasons.slice(0, 4).join(' · ')}`;
    } else {
      rEl.style.display = 'none';
      rEl.textContent = '';
    }
  }

  const aff = document.getElementById('ic-affected');
  if (aff) {
    const failedJobs = [...new Set(builds.filter((b) => b.status === 'failure' || b.status === 'unstable').map((b) => b.job_name))].slice(0, 8);
    const downNames = (snap.services || []).filter((s) => s.status === 'down').map((s) => s.name).slice(0, 8);
    const bits = [];
    if (failedJobs.length) bits.push(`<strong>${esc(t('icenter.affected_jobs'))}:</strong> ${failedJobs.map((j) => esc(j)).join(', ')}`);
    if (downNames.length) bits.push(`<strong>${esc(t('icenter.affected_svcs'))}:</strong> ${downNames.map((n) => esc(n)).join(', ')}`);
    if (pe.length) bits.push(`<strong>${esc(t('icenter.partial_err'))}:</strong> ${pe.map((p) => esc(p.message || p.name || '')).join(' · ')}`);
    aff.innerHTML = bits.length ? bits.join('<br/>') : (hasIssue ? '' : esc(t('icenter.healthy')));
  }

  el.style.display = 'block';

  renderIncidentCards(snap);
  const incidents = analyzeCorrelation(builds);
  renderIcTimeline(incidents);
}

function openRunbook() {
  const ov = document.getElementById('runbook-modal');
  if (!ov) return;
  ov.classList.add('open');
  ov.setAttribute('aria-hidden', 'false');
  refreshRunbookModalBody();
}

function closeRunbook() {
  const ov = document.getElementById('runbook-modal');
  if (!ov) return;
  ov.classList.remove('open');
  ov.setAttribute('aria-hidden', 'true');
}

function icOpenFirstFailureLog() {
  const fails = _lastBuildsForIc.filter((b) => b.status === 'failure' || b.status === 'unstable');
  const b = fails[0];
  if (!b) {
    showToast(t('icenter.no_logs'), 'warn');
    return;
  }
  const src = (b.source || '').toLowerCase();
  if (src === 'jenkins') {
    openLogViewer('jenkins', {
      job_name: b.job_name,
      build_number: b.build_number,
      instance_url: jenkinsBaseFromBuildUrl(b.url),
    });
  } else if (src === 'gitlab') {
    openLogViewer('gitlab', {
      project_id: b.job_name,
      pipeline_id: b.build_number,
      instance_url: gitlabBaseFromPipelineUrl(b.url),
    });
  } else {
    showToast(t('icenter.no_logs'), 'warn');
  }
}

let _backTopInit = false;
function initBackToTop() {
  const btn = document.getElementById('btn-back-top');
  if (!btn) return;
  btn.setAttribute('aria-label', t('common.back_top'));
  if (_backTopInit) return;
  _backTopInit = true;
  window.addEventListener('scroll', () => {
    btn.style.display = window.scrollY > 420 ? 'flex' : 'none';
  }, { passive: true });
  btn.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goToFailedBuildsFromSituation() {
  const src = document.getElementById('f-source')?.value || '';
  const inst = document.getElementById('f-instance')?.value || '';
  filterBuilds(src, 'failure', '', inst);
}

function goToFailedTestsFromSituation() {
  filterTests('failed');
}

function goToServicesDownFromSituation() {
  const cb = document.getElementById('sv-problems-only');
  if (cb) {
    cb.checked = false;
    _svcProblemsOnly = false;
    try { localStorage.setItem('cimon-svc-problems', '0'); } catch { /* ignore */ }
  }
  const sel = document.getElementById('f-svstatus');
  if (sel) sel.value = 'down';
  try { _persistFiltersFromForm(); } catch { /* ignore */ }
  updateFilterSummary();
  resetServices(false);
  goToInTab('services', 'panel-svcs');
}

function updateSituationStrip(failB, failT, downS) {
  _lastSit = { failB, failT, downS };
  const el = document.getElementById('situation-strip');
  if (!el) return;
  const parts = [];
  if (failB > 0) {
    parts.push(`<button type="button" class="sit-stat sit-bad sit-jump" onclick="goToFailedBuildsFromSituation()">${failB} ${esc(t('sit.failed_builds'))}</button>`);
  }
  if (failT > 0) {
    parts.push(`<button type="button" class="sit-stat sit-warn sit-jump" onclick="goToFailedTestsFromSituation()">${failT} ${esc(t('sit.failed_tests'))}</button>`);
  }
  if (downS > 0) {
    parts.push(`<button type="button" class="sit-stat sit-bad sit-jump" onclick="goToServicesDownFromSituation()">${downS} ${esc(t('sit.services_down'))}</button>`);
  }
  const statsHtml = parts.length ? parts.join(' <span style="color:var(--border)">|</span> ') : `<span class="sit-stat sit-ok">${esc(t('sit.no_problems'))}</span>`;
  const nextParts = [];
  if (failB > 0) {
    nextParts.push(`<a href="#" onclick="event.preventDefault();goToFailedBuildsFromSituation()">${esc(t('sit.next_failed_builds'))}</a>`);
  }
  if (downS > 0) {
    nextParts.push(`<a href="#" onclick="event.preventDefault();goToServicesDownFromSituation()">${esc(t('sit.next_services'))}</a>`);
  }
  if (failT > 0) {
    nextParts.push(`<a href="#" onclick="event.preventDefault();goToFailedTestsFromSituation()">${esc(t('sit.next_tests'))}</a>`);
  }
  const nextHtml = nextParts.length
    ? nextParts.join(' <span style="color:var(--border)">|</span> ')
    : `<span class="sit-ok">${esc(t('sit.all_ok'))}</span>`;
  el.innerHTML = `<span class="sit-title">${esc(t('sit.title'))}</span><div class="sit-stats">${statsHtml}</div><div class="sit-next">${esc(t('sit.next_label'))} ${nextHtml}</div>`;
  el.style.display = '';
}

function updateExecHealthLine() {
  const el = document.getElementById('exec-health-line');
  if (!el) return;
  const data = _uptimeData || {};
  const names = Object.keys(data || {});
  if (!names.length) {
    el.classList.remove('visible');
    return;
  }
  const pcts = [];
  names.forEach((name) => {
    const hist = data[name];
    if (!hist || !hist.length) return;
    const ok = hist.filter((h) => h.status === 'up').length;
    pcts.push({ name, pct: Math.round((ok / hist.length) * 100) });
  });
  if (!pcts.length) {
    el.classList.remove('visible');
    return;
  }
  const avg = Math.round(pcts.reduce((s, x) => s + x.pct, 0) / pcts.length);
  const worst = [...pcts].sort((a, b) => a.pct - b.pct)[0];
  let cls = 'eh-ok';
  if (avg < 95) cls = 'eh-warn';
  if (avg < 90 || worst.pct < 70) cls = 'eh-bad';
  el.innerHTML = `<span class="${cls}">${t('exec.prefix')}</span> <strong>${avg}%</strong> ${t('exec.mid')} ${pcts.length} ${t('exec.services')} <strong>${esc(worst.name)}</strong> (${worst.pct}%).`;
  el.classList.add('visible');
}

function setUILang(code) {
  if (code !== 'ru' && code !== 'en') return;
  localStorage.setItem('cimon-ui-lang', code);
  applyUITexts();
  try { refreshIncidentReasonsI18n(); } catch (e) { /* ignore */ }
  _setCollectLines(t('dash.connecting'), '');
  _applyTheme(localStorage.getItem('cimon-theme') === 'light' ? 'light' : 'dark');
  updateSituationStrip(_lastSit.failB, _lastSit.failT, _lastSit.downS);
  updateExecHealthLine();
  updateFilterSummary();
  refreshAll();
  pollCollect();
  try { _refreshChatHelloI18n(); } catch { /* ignore */ }
  try { updateFailuresExportLinks(); } catch { /* ignore */ }
  if (_trendsRawCache && _trendsRawCache.length) renderTrendsFromCache();
  else loadTrends(_trendsViewDays, null);
  _renderFavPanel();
  initBackToTop();
}

function _gid(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const n = parseInt(el.textContent, 10);
  return Number.isFinite(n) ? n : null;
}

function _finalizeStatTrends() {
  const cur = {
    builds: _gid('s-builds'),
    ok: _gid('s-ok'),
    fail: _gid('s-fail'),
    run: _gid('s-run'),
    tfail: _gid('s-tfail'),
    tpass: _gid('s-tpass'),
    down: _gid('s-down'),
    flaky: _gid('s-flaky'),
  };
  const prev = JSON.parse(sessionStorage.getItem('cimon-stat-snap') || 'null');
  const pairs = [
    ['tr-builds', 'builds'],
    ['tr-ok', 'ok'],
    ['tr-fail', 'fail'],
    ['tr-run', 'run'],
    ['tr-tfail', 'tfail'],
    ['tr-tpass', 'tpass'],
    ['tr-down', 'down'],
    ['tr-flaky', 'flaky'],
  ];
  pairs.forEach(([tid, k]) => {
    const el = document.getElementById(tid);
    if (!el || cur[k] == null) return;
    if (!prev || prev[k] == null) {
      el.textContent = '';
      el.className = 'stat-trend';
      return;
    }
    const d = cur[k] - prev[k];
    if (d > 0) {
      el.textContent = '↑' + d;
      el.className = 'stat-trend up';
    } else if (d < 0) {
      el.textContent = '↓' + Math.abs(d);
      el.className = 'stat-trend down';
    } else {
      el.textContent = '→';
      el.className = 'stat-trend';
    }
  });
  sessionStorage.setItem('cimon-stat-snap', JSON.stringify(cur));
}

function _svgTitleAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Debounce factory (returns the same debounced fn each call via closure map)
const _debMap = new Map();
function debounce(fn, ms) {
  if (!_debMap.has(fn)) {
    let t;
    _debMap.set(fn, (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); });
  }
  return _debMap.get(fn);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch helpers (AbortController + simple dedupe)
// ─────────────────────────────────────────────────────────────────────────────
const _fetchCtl = new Map(); // key -> AbortController
const _fetchInFlight = new Map(); // key -> Promise<Response|null>
/** Resolved when fetch was superseded by a newer fetchKeyed for the same key — do not clear UI. */
const FETCH_ABORTED = Symbol('fetch_aborted');
function fetchKeyed(key, url, opts) {
  // Abort any previous request for this key.
  const prev = _fetchCtl.get(key);
  if (prev) { try { prev.abort(); } catch {} }

  const ctl = new AbortController();
  _fetchCtl.set(key, ctl);

  const p = fetch(url, { ...(opts || {}), signal: ctl.signal })
    .then(res => res)
    .catch((e) => {
      if (e && (e.name === 'AbortError' || String(e).includes('AbortError'))) return FETCH_ABORTED;
      return null;
    })
    .finally(() => {
      // Only clear if this is still the current controller.
      if (_fetchCtl.get(key) === ctl) _fetchCtl.delete(key);
      if (_fetchInFlight.get(key) === p) _fetchInFlight.delete(key);
    });

  _fetchInFlight.set(key, p);
  return p;
}

function abortFetchKey(key) {
  const ctl = _fetchCtl.get(key);
  if (ctl) { try { ctl.abort(); } catch {} }
  _fetchCtl.delete(key);
  _fetchInFlight.delete(key);
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel state (per-panel page cursor & IntersectionObserver)
// ─────────────────────────────────────────────────────────────────────────────
const _state = {
  builds:   { page:1, per_page:60, loading:false, done:false, total:0 },
  failures: { page:1, per_page:20, loading:false, done:false, total:0 },
  tests:    { page:1, per_page:30, loading:false, done:false, total:0 },
  svcs:     { page:1, per_page:50, loading:false, done:false, total:0 },
};

let _collapsedBuildGroups = new Set();
function _loadCollapsedBuildGroups() {
  try {
    const raw = localStorage.getItem('cimon-collapsed-build-groups');
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) _collapsedBuildGroups = new Set(arr.map(String));
  } catch { _collapsedBuildGroups = new Set(); }
}
function _saveCollapsedBuildGroups() {
  try { localStorage.setItem('cimon-collapsed-build-groups', JSON.stringify([..._collapsedBuildGroups])); } catch { /* ignore */ }
}
function toggleBuildGroup(encKey) {
  const k = String(encKey || '');
  if (!k) return;
  if (_collapsedBuildGroups.has(k)) _collapsedBuildGroups.delete(k);
  else _collapsedBuildGroups.add(k);
  _saveCollapsedBuildGroups();
  applyBuildGroupVisibility(k);
}
function applyBuildGroupVisibility(encKey) {
  const tbody = document.getElementById('tbody-builds');
  if (!tbody) return;
  const k = String(encKey || '');
  const collapsed = _collapsedBuildGroups.has(k);
  // Toggle build rows (compare attributes — encoded keys contain `%` and break CSS.escape selectors)
  tbody.querySelectorAll('tr[data-bgroup]').forEach((tr) => {
    if (tr.getAttribute('data-bgroup') !== k) return;
    if (tr.classList.contains('src-group-row')) return;
    tr.style.display = collapsed ? 'none' : '';
  });
  tbody.querySelectorAll('tr.src-group-row[data-bgroup]').forEach((tr) => {
    if (tr.getAttribute('data-bgroup') !== k) return;
    const hdr = tr.querySelector('.grp-toggle');
    if (hdr) hdr.textContent = collapsed ? '+' : '−';
  });
}
const _obs = {};

async function fetchApiErrorDetail(res) {
  let detail = '';
  try {
    if (res) {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const j = await res.json();
        detail = (j.detail || j.message || '') + '';
      } else {
        detail = (await res.text() || '').slice(0, 200);
      }
    }
  } catch { /* ignore */ }
  return detail;
}

function _initObserver(key, loadFn) {
  if (_obs[key]) _obs[key].disconnect();
  const sentinel = document.getElementById(`sentinel-${key}`);
  _obs[key] = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) loadFn();
  }, { root: document.getElementById(`wrap-${key}`), threshold: 0, rootMargin: key === 'builds' ? '100px' : '0px' });
  _obs[key].observe(sentinel);
}

// ─────────────────────────────────────────────────────────────────────────────
// Expand / collapse
// ─────────────────────────────────────────────────────────────────────────────
const _expanded = {};
function toggleExpand(key) {
  _expanded[key] = !_expanded[key];
  const wrap = document.getElementById(`wrap-${key}`);
  const btn  = document.getElementById(`expand-${key}`);
  wrap.classList.toggle('expanded', _expanded[key]);
  btn.textContent = _expanded[key] ? t('dash.collapse') : t('dash.expand_panel');
  // re-check sentinel visibility after layout change
  if (_obs[key]) { const s = document.getElementById(`sentinel-${key}`); _obs[key].unobserve(s); _obs[key].observe(s); }
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILDS — log buttons (Jenkins console / GitLab traces)
// ─────────────────────────────────────────────────────────────────────────────
function jenkinsBaseFromBuildUrl(u) {
  if (!u) return '';
  try {
    const o = new URL(u);
    const path = o.pathname;
    const idx = path.indexOf('/job/');
    const basePath = idx > 0 ? path.slice(0, idx) : '';
    return (o.origin + basePath).replace(/\/$/, '');
  } catch { return ''; }
}
function gitlabBaseFromPipelineUrl(u) {
  if (!u) return '';
  try { return new URL(u).origin; } catch { return ''; }
}
function _buildLogCell(b) {
  const src = (b.source || '').toLowerCase();
  const bn = b.build_number;
  if (bn == null) return '—';
  if (src === 'jenkins') {
    const p = { job_name: b.job_name, build_number: bn, instance_url: jenkinsBaseFromBuildUrl(b.url) };
    const showDiff = b.status === 'failure' || b.status === 'unstable';
    const diffArgs = JSON.stringify(['jenkins', b.job_name, bn, jenkinsBaseFromBuildUrl(b.url)]);
    return `<span style="display:inline-flex;gap:3px">
      <button type="button" class="act-btn log-btn" onclick='openLogViewer("jenkins",${JSON.stringify(p)})' title="${_svgTitleAttr(t('dash.log_console'))}">&#128466;</button>
      ${showDiff ? `<button type="button" class="act-btn log-btn" style="font-size:.65rem" onclick='openLogDiff(...${diffArgs})' title="${_svgTitleAttr(t('log.compare_title'))}">&#8644;</button>` : ''}
    </span>`;
  }
  if (src === 'gitlab') {
    const p = { project_id: b.job_name, pipeline_id: bn, instance_url: gitlabBaseFromPipelineUrl(b.url) };
    const stagesArgs = JSON.stringify([b.job_name, bn, gitlabBaseFromPipelineUrl(b.url), 'GitLab: ' + b.job_name + ' #' + bn]);
    const showDiff = b.status === 'failure' || b.status === 'unstable';
    const diffArgs = JSON.stringify(['gitlab', b.job_name, bn, gitlabBaseFromPipelineUrl(b.url)]);
    return `<span style="display:inline-flex;gap:3px">
      <button type="button" class="act-btn log-btn" onclick='openLogViewer("gitlab",${JSON.stringify(p)})' title="${_svgTitleAttr(t('dash.pipeline_job_logs'))}">&#128466;</button>
      <button type="button" class="act-btn log-btn" style="background:var(--info);color:#fff" onclick='openStagesModal(...${stagesArgs})' title="${_svgTitleAttr(t('dash.pipeline_stages_short'))}">&#9646;</button>
      ${showDiff ? `<button type="button" class="act-btn log-btn" style="font-size:.65rem" onclick='openLogDiff(...${diffArgs})' title="${_svgTitleAttr(t('log.compare_title'))}">&#8644;</button>` : ''}
    </span>`;
  }
  return '—';
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILDS
// ─────────────────────────────────────────────────────────────────────────────
function resetBuilds(soft=false) {
  const s = _state.builds; s.page=1; s.done=false;
  const tb = document.getElementById('tbody-builds');
  // Soft reset keeps current rows visible until the refreshed data arrives.
  if (!soft) {
    tb.innerHTML = `<tr class="empty-row"><td colspan="12">${esc(t('dash.table_loading'))}</td></tr>`;
  }
  loadBuilds();
}
function clearBuildFilters() {
  document.getElementById('f-source').value  = '';
  document.getElementById('f-instance').value = '';
  document.getElementById('f-bstatus').value = '';
  document.getElementById('f-job').value     = '';
  _buildsHours = 0;
  document.querySelectorAll('.time-filter-btn').forEach(b => b.classList.remove('active'));
  try { localStorage.setItem('cimon-builds-hours', '0'); } catch { /* ignore */ }
  // Persist empty values to localStorage and strip ?job=… from URL, otherwise F5 restores job from LS.
  try { _persistFiltersFromForm(); } catch { /* ignore */ }
  resetBuilds();
}
// Called from stat cards
function filterBuilds(source, status, job, instance) {
  document.getElementById('f-source').value  = source || '';
  document.getElementById('f-instance').value = instance || '';
  document.getElementById('f-bstatus').value = status || '';
  document.getElementById('f-job').value     = job    || '';
  try { _persistFiltersFromForm(); } catch { /* ignore */ }
  resetBuilds();
  goToInTab('builds', 'panel-builds');
}

async function loadBuilds() {
  const s = _state.builds;
  if (s.loading || s.done) return;
  s.loading = true;

  const source  = document.getElementById('f-source').value;
  const inst    = document.getElementById('f-instance').value;
  const status  = document.getElementById('f-bstatus').value;
  const job     = document.getElementById('f-job').value;
  const url = apiUrl(`api/builds?page=${s.page}&per_page=${s.per_page}&source=${encodeURIComponent(source)}&instance=${encodeURIComponent(inst)}&status=${encodeURIComponent(status)}&job=${encodeURIComponent(job)}&hours=${_buildsHours}`);

  const res = await fetchKeyed('builds', url).catch(()=>null);
  s.loading = false;

  const tbody = document.getElementById('tbody-builds');
  if (res === FETCH_ABORTED) return;
  if (!res || !res.ok) {
    const detail = await fetchApiErrorDetail(res);
    srAnnounce(t('dash.table_api_err') + (detail ? ': ' + detail : ''), 'assertive');
    const extra = detail ? ` — ${esc(detail)}` : '';
    tbody.innerHTML = `<tr class="empty-row"><td colspan="12">${esc(t('dash.table_api_err'))}${extra}<br/><span class="err-hint">${esc(t('err.hint_retry'))}</span> <button type="button" class="btn btn-ghost" onclick="refreshAll()">${esc(t('common.retry'))}</button></td></tr>`;
    _applyGlobalSearch();
    return;
  }
  const data = await res.json();
  s.total = data.total;
  document.getElementById('builds-count').textContent = data.total;

  const rows = data.items;
  if (s.page === 1 && !rows.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="12"><div>${esc(t('dash.table_no_builds'))}</div><div class="empty-hint">${t('dash.empty_builds_hint')}</div>${emptyStateActionsHtml()}</td></tr>`;
    s.done = true; updateFilterSummary(); _applyGlobalSearch(); return;
  }

  const favKeys = _loadFavKeys();
  const _srcKey = (x) => String(x || '').trim().toLowerCase();
  const _instKey = (x) => String(x || '').trim().toLowerCase();
  const sorted = [...rows].sort((a, b) => (a.source || '').localeCompare(b.source || '') || String(a.instance || '').localeCompare(String(b.instance || '')) || String(a.started_at || '').localeCompare(String(b.started_at || '')));
  const groupCountsApi = data.group_counts && typeof data.group_counts === 'object' ? data.group_counts : null;
  // Fallback: per-page counts (if API omits group_counts).
  const gStats = {};
  sorted.forEach((b) => {
    const gk = `${_srcKey(b.source)}||${_instKey(b.instance)}`;
    const stn = String(b.status_normalized || b.status || '').toLowerCase();
    if (!gStats[gk]) gStats[gk] = { ok: 0, warn: 0, fail: 0, total: 0 };
    gStats[gk].total++;
    if (stn === 'failure' || stn === 'failed') gStats[gk].fail++;
    else if (stn === 'unstable') gStats[gk].warn++;
    else if (stn === 'success' || stn === 'passed' || stn === 'ok') gStats[gk].ok++;
  });
  let skipHeaderEnc = null;
  if (s.page > 1 && tbody) {
    const dataRows = Array.from(tbody.querySelectorAll('tr[data-bgroup]')).filter((tr) => !tr.classList.contains('src-group-row'));
    const last = dataRows[dataRows.length - 1];
    if (last) skipHeaderEnc = last.getAttribute('data-bgroup');
  }
  let lastGroup = null;
  const htmlParts = [];
  sorted.forEach((b) => {
    const groupKey = `${_srcKey(b.source)}||${_instKey(b.instance)}`;
    if (groupKey !== lastGroup) {
      const enc = encodeURIComponent(groupKey);
      const skipDupHeader = (skipHeaderEnc != null && enc === skipHeaderEnc && lastGroup === null);
      if (skipDupHeader) skipHeaderEnc = null;
      if (!skipDupHeader) {
      const srcLbl = String(b.source || '').trim();
      const instLbl = String(b.instance || '').trim();
      const lbl = instLbl ? `${srcLbl} · ${instLbl}` : srcLbl;
      const st = (groupCountsApi && groupCountsApi[groupKey]) || gStats[groupKey] || { ok:0, warn:0, fail:0, total:0 };
      const collapsed = _collapsedBuildGroups.has(enc);
      htmlParts.push(
        `<tr class="src-group-row" data-bgroup="${enc}"><td colspan="12">
          <div class="grp-hdr">
            <div class="grp-left">
              <button type="button" class="grp-toggle" onclick='toggleBuildGroup(${JSON.stringify(enc)})' title="Collapse/expand">${collapsed ? '+' : '−'}</button>
              <span class="grp-title">${esc(t('dash.group_source'))}: ${esc(lbl)}</span>
            </div>
            <div class="grp-right">
              <span class="grp-count"><span class="grp-dot fail"></span>${st.fail}</span>
              <span class="grp-count"><span class="grp-dot warn"></span>${st.warn}</span>
              <span class="grp-count"><span class="grp-dot ok"></span>${st.ok}</span>
              <span class="grp-count">/ ${st.total}</span>
            </div>
          </div>
        </td></tr>`
      );
      }
      lastGroup = groupKey;
    }
    const src = b.source.toLowerCase();
    const isStarred = !!favKeys[String(b.job_name ?? '')];
    let actionBtn = '';
    if (src === 'jenkins') {
      actionBtn = `<button class="act-btn" onclick="triggerJenkinsBuild(this,${JSON.stringify(b.job_name)})">&#9654; ${esc(t('dash.act_run'))}</button>`;
    } else if (src === 'gitlab') {
      const ref = b.branch || 'main';
      actionBtn = `<button class="act-btn" onclick="triggerGitlabPipeline(this,${JSON.stringify(b.job_name)},${JSON.stringify(ref)})">&#9654; ${esc(t('dash.act_run'))}</button>`;
    }
    const favPayloadEnc = encodeURIComponent(JSON.stringify({
      source: b.source, job_name: b.job_name, build_number: b.build_number, status: b.status, branch: b.branch,
      started_at: b.started_at, duration_seconds: b.duration_seconds, url: b.url, critical: b.critical,
    }));
    const favJobEnc = encodeURIComponent(String(b.job_name ?? ''));
    const favTitle = _svgTitleAttr(isStarred ? t('dash.fav_remove') : t('dash.fav_add'));
    const jt = _svgTitleAttr(b.job_name);
    const bt = _svgTitleAttr(b.branch || '');
    const cpyTitle = _svgTitleAttr(t('dash.copy_id_title'));
    const bn = b.build_number;
    const numHtml = (bn != null && bn !== '')
      ? `<span class="num-copy-wrap"><span>${esc(String(bn))}</span><button type="button" class="btn-copy-ref" title="${cpyTitle}" aria-label="${cpyTitle}" onclick="copyBuildRef(event,${JSON.stringify(b.job_name)},${JSON.stringify(bn)})">&#128203;</button></span>`
      : '—';
    const srcLbl = (String(b.instance || '').trim())
      ? `${String(b.source || '').trim()} · ${String(b.instance || '').trim()}`
      : String(b.source || '').trim();
    htmlParts.push(`<tr data-job="${encodeURIComponent(b.job_name)}" data-bgroup="${encodeURIComponent(groupKey)}">
    <td class="col-pin-star"><button type="button" class="fav-btn${isStarred?' starred':''}" data-fav-job="${favJobEnc}" data-fav-payload="${favPayloadEnc}" onclick="toggleFavBtn(this)" title="${favTitle}">&#9733;</button></td>
    <td class="col-pin-src"><span class="b b-dim">${esc(srcLbl)}</span></td>
    <td class="col-pin-job" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${jt}">
      ${b.critical ? `<strong>${esc(b.job_name)}</strong>` : esc(b.job_name)}
    </td>
    <td class="mono col-pin-num">${numHtml}</td>
    <td class="col-pin-st">${badge(b.status)}</td>
    <td class="mono context-cell col-compact-hide" style="font-size:.76rem;color:var(--muted);max-width:140px">${_fmtBuildContext(b.analytics)}</td>
    <td class="mono col-compact-hide" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${bt}">${esc(b.branch)}</td>
    <td style="white-space:nowrap">${fmt(b.started_at)}</td>
    <td class="td-duration" style="white-space:nowrap"><span class="dur-val">${dur(b.duration_seconds)}</span>${_sparkSVG(b.job_name, b.status)}</td>
    <td>${b.url ? `<a href="${esc(safeUrl(b.url))}" target="_blank" rel="noopener">&#8599;</a>` : '—'}</td>
    <td>${_buildLogCell(b)}</td>
    <td>${actionBtn}</td>
  </tr>`);
  });
  const html = htmlParts.join('');
  if (s.page === 1) tbody.innerHTML = html;
  else tbody.insertAdjacentHTML('beforeend', html);
  // Apply collapsed state for any groups present in this page.
  try {
    const keys = new Set(sorted.map((b) => encodeURIComponent(`${_srcKey(b.source)}||${_instKey(b.instance)}`)));
    keys.forEach((k) => { if (_collapsedBuildGroups.has(k)) applyBuildGroupVisibility(k); });
  } catch { /* ignore */ }

  _applyGlobalSearch();
  updateFilterSummary();
  if (!data.has_more) { s.done = true; return; }
  s.page++;
}

// ─────────────────────────────────────────────────────────────────────────────
// FAILURES (top-N aggregated)
// ─────────────────────────────────────────────────────────────────────────────
function resetFailures(soft=false) {
  // If a previous page load is in-flight, cancel it so new filters apply immediately.
  abortFetchKey('failures');
  const s = _state.failures; s.page=1; s.done=false; s.loading = false;
  const tb = document.getElementById('tbody-failures');
  if (!soft) tb.innerHTML = `<tr class="empty-row"><td colspan="5">${esc(t('dash.table_loading'))}</td></tr>`;
  loadFailures();
}
function clearFailureFilters() {
  document.getElementById('f-fname').value  = '';
  document.getElementById('f-fsuite').value = '';
  _failuresDays = 0;
  ['tf-f-1d','tf-f-3d','tf-f-7d','tf-f-30d'].forEach((id) => document.getElementById(id)?.classList.remove('active'));
  try { localStorage.setItem('cimon-failures-days', '0'); } catch { /* ignore */ }
  _syncURLAndFilterSummary();
  updateFailuresExportLinks();
  resetFailures();
}
// Called from stat cards
function filterTests(status) {
  document.getElementById('f-tstatus').value = status;
  try { _persistFiltersFromForm(); } catch { /* ignore */ }
  resetTests();
  goToInTab('tests', 'panel-tests');
}

async function loadFailures() {
  const s = _state.failures;
  if (s.loading || s.done) return;
  s.loading = true;

  const name  = document.getElementById('f-fname').value;
  const suite = document.getElementById('f-fsuite').value;
  const source = document.getElementById('f-tsource')?.value || '';
  const dayQ = _failuresDays > 0 ? `&days=${_failuresDays}` : '';
  const url = apiUrl(`api/tests/top-failures?page=${s.page}&per_page=${s.per_page}&n=500&source=${encodeURIComponent(source)}&name=${encodeURIComponent(name)}&suite=${encodeURIComponent(suite)}${dayQ}`);

  const res = await fetchKeyed('failures', url).catch(()=>null);
  s.loading = false;

  const tbody = document.getElementById('tbody-failures');
  if (res === FETCH_ABORTED) return;
  if (!res || !res.ok) {
    if (res && res.status === 404) { tbody.innerHTML = `<tr class="empty-row"><td colspan="5">${esc(t('dash.table_no_test_data'))}${emptyStateActionsHtml()}</td></tr>`; }
    else {
      const detail = await fetchApiErrorDetail(res);
      srAnnounce(t('dash.table_api_err') + (detail ? ': ' + detail : ''), 'assertive');
      const extra = detail ? ` — ${esc(detail)}` : '';
      tbody.innerHTML = `<tr class="empty-row"><td colspan="5">${esc(t('dash.table_api_err'))}${extra}<br/><span class="err-hint">${esc(t('err.hint_retry'))}</span> <button type="button" class="btn btn-ghost" onclick="refreshAll()">${esc(t('common.retry'))}</button></td></tr>`;
    }
    s.done = true; updateFilterSummary(); _applyGlobalSearch(); return;
  }
  const data = await res.json();
  s.total = data.total;
  document.getElementById('failures-count').textContent = data.total;

  const rows = data.items;
  if (s.page === 1 && !rows.length) {
    if (_dashIsCollecting && tbody && tbody.querySelector('tr:not(.empty-row)')) {
      s.done = true;
      updateFilterSummary();
      _applyGlobalSearch();
      return;
    }
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5"><div>${esc(t('dash.table_no_failures'))}</div><div class="empty-hint">${t('dash.empty_failures_hint')}</div>${emptyStateActionsHtml()}</td></tr>`;
    s.done = true; updateFilterSummary(); _applyGlobalSearch(); return;
  }

  const offset = (s.page - 1) * s.per_page;
  const frag = document.createDocumentFragment();
  rows.forEach((f, i) => {
    const tr = document.createElement('tr');

    const td0 = document.createElement('td');
    td0.className = 'mono c-fail';
    td0.style.fontWeight = '700';
    td0.textContent = String(offset + i + 1);

    const td1 = document.createElement('td');
    td1.style.maxWidth = '280px';
    td1.style.wordBreak = 'break-word';
    td1.title = String(f.test_name || '');
    if (f.source) {
      const b = document.createElement('span');
      b.className = 'b b-purple';
      b.style.fontSize = '.66rem';
      b.textContent = String(f.source).replace('jenkins_', '').toUpperCase().slice(0, 8);
      td1.appendChild(b);
      td1.appendChild(document.createTextNode(' '));
    }
    td1.appendChild(document.createTextNode(String(f.test_name || '')));

    const td2 = document.createElement('td');
    td2.style.maxWidth = '160px';
    td2.style.color = 'var(--muted)';
    td2.style.fontSize = '.78rem';
    td2.title = String(f.suite || '');
    td2.textContent = String(f.suite || '');

    const td3 = document.createElement('td');
    const strong = document.createElement('strong');
    strong.className = 'c-fail';
    strong.textContent = String(f.count ?? '');
    td3.appendChild(strong);

    const td4 = document.createElement('td');
    td4.style.maxWidth = '360px';
    td4.style.wordBreak = 'break-word';
    td4.style.fontSize = '.78rem';
    td4.style.color = 'var(--muted)';
    td4.title = String(f.message || '');
    td4.textContent = String(f.message || '');

    tr.append(td0, td1, td2, td3, td4);
    frag.appendChild(tr);
  });
  if (s.page === 1) tbody.replaceChildren(frag);
  else tbody.appendChild(frag);

  _applyGlobalSearch();
  updateFilterSummary();
  if (!data.has_more) { s.done = true; return; }
  s.page++;
}

// ─────────────────────────────────────────────────────────────────────────────
// ALL TEST RUNS
// ─────────────────────────────────────────────────────────────────────────────
function resetTests() {
  resetTestsSoft(false);
}
function resetTestsSoft(soft=false) {
  // If a previous page load is in-flight, cancel it so new filters apply immediately.
  abortFetchKey('tests');
  const s = _state.tests; s.page=1; s.done=false; s.loading = false;
  const tb = document.getElementById('tbody-tests');
  if (!soft) tb.innerHTML = `<tr class="empty-row"><td colspan="6">${esc(t('dash.table_loading'))}</td></tr>`;
  loadTests();
}
function clearTestFilters() {
  document.getElementById('f-tstatus').value = '';
  document.getElementById('f-tsource').value = 'real';
  document.getElementById('f-tname').value   = '';
  document.getElementById('f-tsuite').value  = '';
  _testsHours = 0;
  ['tf-t-6h','tf-t-24h','tf-t-7d'].forEach((id) => document.getElementById(id)?.classList.remove('active'));
  try { localStorage.setItem('cimon-tests-hours', '0'); } catch {}
  _syncURLAndFilterSummary();
  updateTestsExportLinks();
  resetTests();
}

function updateTestsExportLinks() {
  const src = document.getElementById('f-tsource')?.value || '';
  const a1 = document.getElementById('exp-tests-csv');
  const a2 = document.getElementById('exp-tests-xlsx');
  const a3 = document.getElementById('exp-tests-failed-csv');
  if (a1) a1.href = `api/export/tests?fmt=csv${src ? '&source=' + encodeURIComponent(src) : ''}`;
  if (a2) a2.href = `api/export/tests?fmt=xlsx${src ? '&source=' + encodeURIComponent(src) : ''}`;
  if (a3) a3.href = `api/export/tests?fmt=csv&status=failed${src ? '&source=' + encodeURIComponent(src) : ''}`;
}

function updateFailuresExportLinks() {
  const src = document.getElementById('f-tsource')?.value || '';
  const d = _failuresDays > 0 ? `&days=${_failuresDays}` : '';
  const q = (extra) => `api/export/failures?fmt=${extra}&n=500${src ? '&source=' + encodeURIComponent(src) : ''}${d}`;
  const c = document.getElementById('exp-failures-csv');
  const x = document.getElementById('exp-failures-xlsx');
  if (c) c.href = q('csv');
  if (x) x.href = q('xlsx');
}

function toggleFailuresDayFilter(days) {
  const n = parseInt(String(days), 10) || 0;
  const wasOn = _failuresDays === n;
  _failuresDays = wasOn ? 0 : n;
  ['tf-f-1d','tf-f-3d','tf-f-7d','tf-f-30d'].forEach((id) => document.getElementById(id)?.classList.remove('active'));
  if (!wasOn && n > 0) {
    const map = { 1: 'tf-f-1d', 3: 'tf-f-3d', 7: 'tf-f-7d', 30: 'tf-f-30d' };
    document.getElementById(map[n])?.classList.add('active');
  }
  try { localStorage.setItem('cimon-failures-days', String(_failuresDays)); } catch { /* ignore */ }
  updateFailuresExportLinks();
  updateFilterSummary();
  resetFailures();
}

async function loadTests() {
  const s = _state.tests;
  if (s.loading || s.done) return;
  s.loading = true;

  _syncTestSourceQuickButtons();
  const status = document.getElementById('f-tstatus').value;
  const source = document.getElementById('f-tsource').value;
  const name   = document.getElementById('f-tname').value;
  const suite  = document.getElementById('f-tsuite').value;
  const url = apiUrl(`api/tests?page=${s.page}&per_page=${s.per_page}&status=${encodeURIComponent(status)}&source=${encodeURIComponent(source)}&name=${encodeURIComponent(name)}&suite=${encodeURIComponent(suite)}&hours=${_testsHours}`);

  const res = await fetchKeyed('tests', url).catch(()=>null);
  s.loading = false;

  const tbody = document.getElementById('tbody-tests');
  if (res === FETCH_ABORTED) return;
  if (!res || !res.ok) {
    if (res && res.status === 404) { tbody.innerHTML = `<tr class="empty-row"><td colspan="6">${esc(t('dash.table_no_test_data'))}${emptyStateActionsHtml()}</td></tr>`; }
    else {
      const detail = await fetchApiErrorDetail(res);
      srAnnounce(t('dash.table_api_err') + (detail ? ': ' + detail : ''), 'assertive');
      const extra = detail ? ` — ${esc(detail)}` : '';
      tbody.innerHTML = `<tr class="empty-row"><td colspan="6">${esc(t('dash.table_api_err'))}${extra}<br/><span class="err-hint">${esc(t('err.hint_retry'))}</span> <button type="button" class="btn btn-ghost" onclick="refreshAll()">${esc(t('common.retry'))}</button></td></tr>`;
    }
    s.done = true; updateFilterSummary(); _applyGlobalSearch(); return;
  }
  const data = await res.json();
  s.total = data.total;
  document.getElementById('tests-count').textContent = data.total;
  if (data.breakdown) {
    const b = data.breakdown;
    const el = document.getElementById('tests-breakdown');
    if (el) el.textContent = `Real: ${b.real_total || 0} (${b.real_failed || 0} failed) · Synthetic: ${b.synthetic_total || 0} (${b.synthetic_failed || 0} failed)`;
  }

  const rows = data.items;
  if (s.page === 1 && !rows.length) {
    if (_dashIsCollecting && tbody && tbody.querySelector('tr:not(.empty-row)')) {
      s.done = true;
      updateFilterSummary();
      _applyGlobalSearch();
      return;
    }
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6"><div>${esc(t('dash.table_no_tests'))}</div><div class="empty-hint">${t('dash.empty_tests_hint')}</div>${emptyStateActionsHtml()}</td></tr>`;
    s.done = true; updateFilterSummary(); _applyGlobalSearch(); return;
  }

  const mkSrcBadge = (src) => {
    const s = String(src || '').toLowerCase();
    const span = document.createElement('span');
    span.className = 'b';
    span.style.fontSize = '.66rem';
    if (s === 'jenkins_allure') { span.className = 'b b-green'; span.title = 'Allure'; span.textContent = 'ALLURE'; return span; }
    if (s === 'jenkins_console') { span.className = 'b b-purple'; span.title = 'Console'; span.textContent = 'CONSOLE'; return span; }
    if (s === 'jenkins_build') { span.className = 'b b-yellow'; span.title = 'Synthetic (job as test)'; span.textContent = 'JOB'; return span; }
    span.title = s;
    span.textContent = s ? s.slice(0, 10) : '';
    return span;
  };
  const frag = document.createDocumentFragment();
  rows.forEach((row) => {
    const tr = document.createElement('tr');

    const td0 = document.createElement('td');
    td0.style.maxWidth = '260px';
    td0.style.wordBreak = 'break-word';
    td0.title = String(row.test_name || '');
    if (row.source) {
      td0.appendChild(mkSrcBadge(row.source));
      td0.appendChild(document.createTextNode(' '));
    }
    td0.appendChild(document.createTextNode(String(row.test_name || '')));

    const td1 = document.createElement('td');
    td1.style.maxWidth = '160px';
    td1.style.color = 'var(--muted)';
    td1.style.fontSize = '.78rem';
    td1.title = String(row.suite || '');
    td1.textContent = String(row.suite || '');

    const td2 = document.createElement('td');
    td2.innerHTML = badge(row.status); // badge() returns trusted fixed HTML

    const td3 = document.createElement('td');
    td3.style.whiteSpace = 'nowrap';
    td3.textContent = dur(row.duration_seconds);

    const td4 = document.createElement('td');
    td4.style.whiteSpace = 'nowrap';
    td4.style.fontSize = '.78rem';
    td4.textContent = fmt(row.timestamp);

    const td5 = document.createElement('td');
    td5.className = 'col-compact-hide';
    td5.style.maxWidth = '360px';
    td5.style.wordBreak = 'break-word';
    td5.style.fontSize = '.78rem';
    td5.style.color = 'var(--muted)';
    td5.title = String(row.failure_message || '');
    td5.textContent = String(row.failure_message || '');

    tr.append(td0, td1, td2, td3, td4, td5);
    frag.appendChild(tr);
  });
  if (s.page === 1) tbody.replaceChildren(frag);
  else tbody.appendChild(frag);

  _applyGlobalSearch();
  updateFilterSummary();
  if (!data.has_more) { s.done = true; return; }
  s.page++;
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVICES
// ─────────────────────────────────────────────────────────────────────────────
function resetServices(soft=false) {
  const s = _state.svcs; s.page=1; s.done=false;
  const tb = document.getElementById('tbody-svcs');
  if (!soft) tb.innerHTML = `<tr class="empty-row"><td colspan="8">${esc(t('dash.table_loading'))}</td></tr>`;
  loadServices();
}
function clearSvcFilters() {
  document.getElementById('f-svstatus').value = '';
  _svcProblemsOnly = false;
  const cb = document.getElementById('sv-problems-only');
  if (cb) cb.checked = false;
  try { localStorage.setItem('cimon-svc-problems', '0'); } catch {}
  _syncURLAndFilterSummary();
  resetServices();
}

function toggleSvcProblemsOnly(on) {
  _svcProblemsOnly = !!on;
  try { localStorage.setItem('cimon-svc-problems', _svcProblemsOnly ? '1' : '0'); } catch {}
  if (_svcProblemsOnly) {
    document.getElementById('f-svstatus').value = 'problems';
  } else if (document.getElementById('f-svstatus').value === 'problems') {
    document.getElementById('f-svstatus').value = '';
  }
  _syncURLAndFilterSummary();
  resetServices();
}

function _svcLastChangeMap() {
  const out = {};
  try {
    const items = Array.isArray(_persistedEvents) ? _persistedEvents : [];
    for (let i = items.length - 1; i >= 0; i--) {
      const ev = items[i];
      if (!ev || (ev.kind !== 'svc_down' && ev.kind !== 'svc_recovered')) continue;
      const title = String(ev.title || '');
      const m = title.match(/Service (DOWN|UP):\s*(.+)$/);
      if (!m) continue;
      const name = m[2].trim();
      if (!name || out[name]) continue;
      const dt = ev.ts ? new Date(String(ev.ts)) : null;
      out[name] = { ts: dt && !isNaN(dt.getTime()) ? dt : null, kind: ev.kind };
    }
  } catch { /* ignore */ }
  return out;
}

function _fmtAgo(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 0) return '';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

async function loadServices() {
  const s = _state.svcs;
  if (s.loading || s.done) return;
  s.loading = true;

  const status = document.getElementById('f-svstatus').value;
  const url = apiUrl(`api/services?page=${s.page}&per_page=${s.per_page}&status=${encodeURIComponent(status)}`);

  const res = await fetchKeyed('services', url).catch(()=>null);
  s.loading = false;

  const tbody = document.getElementById('tbody-svcs');
  if (res === FETCH_ABORTED) return;
  if (!res || !res.ok) {
    if (res && res.status === 404) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="8">${esc(t('dash.table_no_test_data'))}${emptyStateActionsHtml()}</td></tr>`;
    } else {
      const detail = await fetchApiErrorDetail(res);
      srAnnounce(t('dash.table_api_err') + (detail ? ': ' + detail : ''), 'assertive');
      const extra = detail ? ` — ${esc(detail)}` : '';
      tbody.innerHTML = `<tr class="empty-row"><td colspan="8">${esc(t('dash.table_api_err'))}${extra}<br/><span class="err-hint">${esc(t('err.hint_retry'))}</span> <button type="button" class="btn btn-ghost" onclick="refreshAll()">${esc(t('common.retry'))}</button></td></tr>`;
    }
    s.done = true; updateFilterSummary(); return;
  }
  const data = await res.json();
  s.total = data.total;
  document.getElementById('svcs-count').textContent = data.total;

  const rows = data.items;
  if (s.page === 1 && !rows.length) {
    if (_dashIsCollecting && tbody && tbody.querySelector('tr:not(.empty-row)')) {
      s.done = true;
      updateFilterSummary();
      return;
    }
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8"><div>${esc(t('dash.table_no_svcs'))}</div><div class="empty-hint">${t('dash.empty_svcs_hint')}</div>${emptyStateActionsHtml()}</td></tr>`;
    s.done = true; updateFilterSummary(); return;
  }
  // Services header summary (Docker/HTTP groups) — computed from current snapshot via persisted events.
  try {
    const sumEl = document.getElementById('svcs-summary');
    if (sumEl) {
      const allSvcs = (_lastSnap && Array.isArray(_lastSnap.services)) ? _lastSnap.services : null;
      const items = allSvcs || rows;
      const byKind = {};
      items.forEach((sv) => {
        const k = String((sv && sv.kind) || 'unknown');
        const st = String((sv && sv.status) || '').toLowerCase();
        if (!byKind[k]) byKind[k] = { up:0, down:0, degraded:0, total:0 };
        byKind[k].total++;
        if (st === 'down') byKind[k].down++;
        else if (st === 'degraded') byKind[k].degraded++;
        else if (st === 'up') byKind[k].up++;
      });
      const parts = Object.keys(byKind).sort().map((k) => {
        const v = byKind[k];
        return `${k}: ${v.down}↓ ${v.degraded}~ ${v.up}↑`;
      });
      sumEl.textContent = parts.length ? parts.join(' · ') : '—';
    }
  } catch { /* ignore */ }

  const lastCh = _svcLastChangeMap();
  const html = rows.map(sv => {
    let actionBtn = '';
    let logCell = '—';
    if (sv.kind === 'docker') {
      const up = (sv.status || '').toLowerCase() === 'up';
      const nm = JSON.stringify(sv.name);
      const p = { container: sv.name, status: sv.status };
      logCell = `<button type="button" class="act-btn log-btn" onclick='openLogViewer("docker",${JSON.stringify(p)})' title="${_svgTitleAttr(t('dash.log_title'))}">&#128466;</button>`;
      if (up) {
        actionBtn = `<div class="act-group">
          <button type="button" class="act-btn docker-stop" title="Остановить" onclick="dockerContainerAction(this,${nm},'stop')">&#9632; Stop</button>
          <button type="button" class="act-btn docker-btn" title="Перезапустить" onclick="dockerContainerAction(this,${nm},'restart')">&#8635; Restart</button>
        </div>`;
      } else {
        actionBtn = `<div class="act-group">
          <button type="button" class="act-btn docker-start" title="Запустить" onclick="dockerContainerAction(this,${nm},'start')">&#9654; Start</button>
          <button type="button" class="act-btn docker-btn" title="Перезапустить" onclick="dockerContainerAction(this,${nm},'restart')">&#8635; Restart</button>
        </div>`;
      }
    }
    const uptimeHtml = _svcUptimeBar(sv.name);
    const dt = _svgTitleAttr(sv.detail || '');
    const ch = lastCh[String(sv.name || '')];
    const chAgo = ch && ch.ts ? _fmtAgo(ch.ts) : '';
    const chTxt = chAgo ? ` · ${chAgo}` : '';
    return `<tr>
    <td><strong title="${_svgTitleAttr(sv.name)}">${esc(sv.name)}</strong></td>
    <td>${esc(sv.kind)}</td>
    <td>${badge(sv.status)}</td>
    <td class="col-compact-hide" style="color:var(--muted);font-size:.8rem" title="${dt}">${esc(sv.detail)}</td>
    <td style="white-space:nowrap;font-size:.78rem" title="${_svgTitleAttr(chAgo ? ('Last change: ' + chAgo) : '')}">${fmt(sv.checked_at)}<span style="color:var(--muted)">${esc(chTxt)}</span></td>
    <td class="col-compact-hide">${uptimeHtml}</td>
    <td>${logCell}</td>
    <td style="text-align:right">${actionBtn}</td>
  </tr>`;
  }).join('');

  if (s.page === 1) tbody.innerHTML = html;
  else tbody.insertAdjacentHTML('beforeend', html);

  _applyGlobalSearch();
  updateFilterSummary();
  if (!data.has_more) { s.done = true; return; }
  s.page++;
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

function _autoRefreshVisiblePanelsDuringCollect(summaryObj) {
  const c = summaryObj && summaryObj.collect;
  if (!c || !c.is_collecting) return;
  const now = Date.now();
  if (now - _collectAutoRefreshTs < 5000) return; // 5s throttle
  _collectAutoRefreshTs = now;

  // Keep only the active tab live to avoid hammering the backend.
  if (_dashTab === 'tests') {
    resetFailures(true);
    resetTestsSoft(true);
  } else if (_dashTab === 'builds') {
    resetBuilds(true);
  } else if (_dashTab === 'services') {
    resetServices(true);
  } else if (_dashTab === 'logs') {
    loadCollectLogs();
    loadCollectSlowTop();
  }
}

function resetCollectLogs() {
  _collectLogsOffset = 0;
  const pre = document.getElementById('collectlog-pre');
  if (pre) pre.innerHTML = '';
  loadCollectLogs();
}

function clearCollectLogs() {
  _collectLogsOffset = _collectLogsTotal;
  const pre = document.getElementById('collectlog-pre');
  if (pre) pre.innerHTML = '';
  const cnt = document.getElementById('collectlog-count');
  if (cnt) cnt.textContent = '0';
  _collectLogsWarn = 0; _collectLogsErr = 0;
  const w = document.getElementById('collectlog-warn');
  const e = document.getElementById('collectlog-err');
  if (w) w.textContent = '0 warn';
  if (e) e.textContent = '0 err';
}

function collectLogsErrorsOnly() {
  const sel = document.getElementById('f-cl-level');
  if (sel) sel.value = 'error';
  resetCollectLogs();
}

async function loadCollectLogs() {
  const now = Date.now();
  if (now - _collectLogsPollTs < 1200) return;
  _collectLogsPollTs = now;

  const level = (document.getElementById('f-cl-level')?.value || '').trim().toLowerCase();
  const inst = (document.getElementById('f-cl-inst')?.value || '').trim();
  const phase = (document.getElementById('f-cl-phase')?.value || '').trim();
  const jobSub = (document.getElementById('f-cl-job')?.value || '').trim().toLowerCase();
  const q = (document.getElementById('f-cl-q')?.value || '').trim().toLowerCase();
  const follow = !!document.getElementById('cl-follow')?.checked;

  const url = apiUrl(`api/collect/logs?limit=800&offset=${_collectLogsOffset}`);
  const res = await fetch(url).catch(()=>null);
  if (!res || !res.ok) return;
  const data = await res.json().catch(()=>null);
  if (!data || !Array.isArray(data.items)) return;
  _collectLogsTotal = data.total || _collectLogsTotal;

  const pre = document.getElementById('collectlog-pre');
  if (!pre) return;

  const htmlLines = [];
  for (const it of data.items) {
    if (!it) continue;
    // Populate instance dropdown from stream
    if (it.instance) _collectLogsInstances.add(String(it.instance));
    if (it.level === 'warn') _collectLogsWarn++;
    if (it.level === 'error') _collectLogsErr++;

    if (level && String(it.level || '').toLowerCase() !== level) continue;
    if (inst && String(it.instance || '') !== inst) continue;
    if (phase && it.phase !== phase) continue;
    const msg = (it.sub ? `${it.main} · ${it.sub}` : it.main) || '';
    const lvlTag = (it.level ? String(it.level).toUpperCase() : 'INFO');
    const ts = (it.ts || '').replace('T',' ').replace('Z','');
    const line = `[${ts}] ${lvlTag} ${it.phase || 'collect'}: ${msg}`;
    if (jobSub && String(it.job || '').toLowerCase().indexOf(jobSub) < 0) continue;
    if (q && line.toLowerCase().indexOf(q) < 0) continue;
    const cls = (it.level === 'error') ? 'cl-err' : (it.level === 'warn') ? 'cl-warn' : 'cl-info';
    htmlLines.push(`<span class="cl-line ${cls}"><span class="cl-tag">${esc(lvlTag)}</span> ${esc(ts)} ${esc(it.phase || 'collect')}: ${esc(msg)}</span>`);
  }
  // Refresh instance selector options (cheap)
  const instSel = document.getElementById('f-cl-inst');
  if (instSel) {
    const cur = instSel.value;
    const opts = ['<option value="">All instances</option>'].concat([..._collectLogsInstances].sort().map(n => `<option value="${_escHtml(n)}">${_escHtml(n)}</option>`));
    instSel.innerHTML = opts.join('');
    if (cur && [...instSel.options].some(o => o.value === cur)) instSel.value = cur;
  }
  const w = document.getElementById('collectlog-warn');
  const e = document.getElementById('collectlog-err');
  if (w) w.textContent = `${_collectLogsWarn} warn`;
  if (e) e.textContent = `${_collectLogsErr} err`;

  if (htmlLines.length) {
    pre.insertAdjacentHTML('beforeend', htmlLines.join(''));
    const lineNodes = Array.from(pre.querySelectorAll('.cl-line'));
    const maxLines = 2500;
    if (lineNodes.length > maxLines) {
      const remove = lineNodes.length - maxLines;
      for (let i = 0; i < remove; i++) {
        try { lineNodes[i].remove(); } catch { /* ignore */ }
      }
    }
    const cnt = document.getElementById('collectlog-count');
    if (cnt) cnt.textContent = String(pre.querySelectorAll('.cl-line').length);
    if (follow) pre.scrollTop = pre.scrollHeight;
  }
  _collectLogsOffset = data.total || (_collectLogsOffset + data.items.length);
}

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
    updateFreshnessBar(metaObj);
    updateCorrelationHint(metaObj);
  } else {
    const fb = document.getElementById('freshness-bar');
    const ch = document.getElementById('correlation-hint');
    if (fb) fb.style.display = 'none';
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

// ─────────────────────────────────────────────────────────────────────────────
// Status Map
// ─────────────────────────────────────────────────────────────────────────────
let _mapVisible = true;
let _mapTooltipTimer = null;

function toggleMapPanel() {
  _mapVisible = !_mapVisible;
  const body = document.getElementById('map-body');
  const btn  = document.getElementById('map-toggle-btn');
  if (body) body.style.display = _mapVisible ? '' : 'none';
  if (btn)  btn.textContent = _mapVisible ? t('dash.map_hide') : t('dash.map_show');
}

function renderStatusMap(builds, services) {
  const grid  = document.getElementById('map-grid');
  const count = document.getElementById('map-count');
  const panel = document.getElementById('panel-status-map');
  if (!grid) return;

  const STATUS_CLS = { success:'mc-ok', failure:'mc-fail', running:'mc-run', unstable:'mc-warn', aborted:'mc-unknown', unknown:'mc-unknown' };
  const SVC_CLS   = { up:'mc-ok', down:'mc-fail', degraded:'mc-warn' };

  // Latest build per job+instance (most recent first)
  const jobLatest = {};
  builds.forEach(b => {
    const key = `${b.source || ''}||${b.instance || ''}||${b.job_name || ''}`;
    const prev = jobLatest[key];
    if (!prev || (b.started_at || '') > (prev.started_at || '')) jobLatest[key] = b;
  });

  const sortedJobs = Object.values(jobLatest).sort((a, b) => {
    const ord = {failure:0, running:1, unstable:2, success:3, aborted:4, unknown:5};
    const aGrp = `${a.source || ''}||${a.instance || ''}`;
    const bGrp = `${b.source || ''}||${b.instance || ''}`;
    return aGrp.localeCompare(bGrp)
      || (ord[a.status]??5) - (ord[b.status]??5)
      || a.job_name.localeCompare(b.job_name);
  });

  // Group tiles by source+instance so big installations stay readable.
  const groups = {};
  sortedJobs.forEach(b => {
    const k = `${b.source || ''}||${b.instance || ''}`;
    (groups[k] = groups[k] || []).push(b);
  });

  let html = '';
  Object.keys(groups).sort().forEach((k) => {
    const items = groups[k] || [];
    const sample = items[0] || {};
    const label = sample.instance ? `${sample.source} · ${sample.instance}` : (sample.source || 'source');
    html += `<div class="map-group">
      <div class="map-group-hdr">
        <span class="map-group-title">${_escHtml(label)}</span>
        <span class="map-group-sub">${_escHtml(items.length)} job(s)</span>
      </div>
      <div class="map-group-grid">`;
    items.forEach((b) => {
      const cls = STATUS_CLS[b.status] || 'mc-unknown';
      const name = b.instance ? `${b.source} · ${b.instance} / ${b.job_name}` : `${b.source} / ${b.job_name}`;
      html += `<div class="map-cell ${cls}"
        data-name="${_escHtml(name)}"
        data-status="${_escHtml(b.status)}"
        data-detail="${_escHtml(b.branch ? 'Branch: ' + b.branch : '')}"
        data-job="${_escHtml(b.job_name)}"></div>`;
    });
    html += `</div></div>`;
  });

  services.forEach(sv => {
    const cls = (SVC_CLS[sv.status] || 'mc-unknown') + ' mc-svc';
    // Services are global — append as one trailing group for clarity.
    // If there are no job groups, this still renders.
    if (!html) {
      html += `<div class="map-group"><div class="map-group-hdr">
        <span class="map-group-title">${_escHtml('Services')}</span>
        <span class="map-group-sub">${_escHtml('')}</span>
      </div><div class="map-group-grid">`;
    } else if (!html.includes('data-svc=')) {
      html += `<div class="map-group"><div class="map-group-hdr">
        <span class="map-group-title">${_escHtml('Services')}</span>
        <span class="map-group-sub">${_escHtml('')}</span>
      </div><div class="map-group-grid">`;
    }
    html += `<div class="map-cell ${cls}"
      data-name="${_escHtml((sv.kind || '') + ': ' + (sv.name || ''))}"
      data-status="${_escHtml(sv.status || '')}"
      data-detail="${_escHtml(sv.detail || '')}"
      data-svc="${_escHtml(sv.name || '')}"></div>`;
  });
  if (services.length) html += `</div></div>`;

  grid.innerHTML = html;

  // Event delegation on grid
  grid.onmouseover = e => {
    const cell = e.target.closest('.map-cell');
    if (!cell) return;
    clearTimeout(_mapTooltipTimer);
    showMapTooltip(e, cell.dataset.name, cell.dataset.status, cell.dataset.detail);
  };
  grid.onmousemove = e => {
    const cell = e.target.closest('.map-cell');
    if (cell) _posMapTooltip(e); else hideMapTooltip();
  };
  grid.onmouseleave = () => hideMapTooltip();
  grid.onclick = e => {
    const cell = e.target.closest('.map-cell');
    if (!cell) return;
    if (cell.dataset.job) filterBuilds('', '', cell.dataset.job);
    else if (cell.dataset.svc) goToInTab('services', 'panel-svcs');
  };

  const total = sortedJobs.length + services.length;
  if (count) count.textContent = `${sortedJobs.length} jobs · ${services.length} svcs`;
  if (panel && total > 0) panel.style.display = '';
}

function showMapTooltip(e, name, status, detail) {
  const t = document.getElementById('map-tooltip');
  if (!t) return;
  const statusColor = _statusColorHex(status);
  t.innerHTML = `<strong>${_escHtml(name)}</strong><br><span style="color:${statusColor}">${_escHtml(status)}</span>${detail ? `<br><span style="color:var(--muted);font-size:.7rem">${_escHtml(detail)}</span>` : ''}`;
  t.style.display = 'block';
  _posMapTooltip(e);
}

function _posMapTooltip(e) {
  const t = document.getElementById('map-tooltip');
  if (!t || t.style.display === 'none') return;
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = e.clientX + 16, y = e.clientY - 10;
  if (x + 230 > vw) x = e.clientX - 230;
  if (y + 70  > vh) y = e.clientY - 70;
  t.style.left = x + 'px';
  t.style.top  = y + 'px';
}

function hideMapTooltip() {
  clearTimeout(_mapTooltipTimer);
  _mapTooltipTimer = setTimeout(() => {
    const t = document.getElementById('map-tooltip');
    if (t) t.style.display = 'none';
  }, 80);
}

// ─────────────────────────────────────────────────────────────────────────────
// Log Diff
// ─────────────────────────────────────────────────────────────────────────────
function closeDiffModal() {
  const m = document.getElementById('diff-modal');
  if (m) { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); }
}

async function openLogDiff(source, jobName, buildNumber, instanceUrl) {
  const modal = document.getElementById('diff-modal');
  const pre   = document.getElementById('diff-pre');
  const title = document.getElementById('diff-modal-title');
  if (!modal || !pre) return;

  title.textContent = tf('dash.diff_title_fmt', { source, job: jobName, num: buildNumber });
  pre.textContent = t('dash.loading_diff');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');

  try {
    const q = new URLSearchParams({ source, job_name: jobName, build_number: String(buildNumber) });
    if (instanceUrl) q.set('instance_url', instanceUrl);
    const r = await fetch(apiUrl('api/logs/diff?' + q));
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      pre.textContent = t('dash.log_error_prefix') + (e.detail || r.statusText);
      return;
    }
    const data = await r.json();
    const refLabel =
      data.reference_kind === 'last_build' ? t('dash.diff_ref_last_build') : t('dash.diff_ref_last_ok');
    title.textContent = tf('dash.diff_title_result', {
      cur: data.current_build, ref: data.reference_build, refKind: refLabel, job: jobName,
    });

    const lines = data.diff || [];
    if (!lines.length) {
      pre.textContent = t('dash.diff_no_changes');
      return;
    }

    pre.innerHTML = lines.map(line => {
      const escaped = _escHtml(line);
      if (line.startsWith('+++') || line.startsWith('---')) return `<span class="diff-hdr">${escaped}</span>`;
      if (line.startsWith('@@')) return `<span class="diff-hdr">${escaped}</span>`;
      if (line.startsWith('+')) return `<span class="diff-add">${escaped}</span>`;
      if (line.startsWith('-')) return `<span class="diff-del">${escaped}</span>`;
      return `<span class="diff-ctx">${escaped}</span>`;
    }).join('');
  } catch (e) {
    pre.textContent = t('dash.log_error_prefix') + e.message;
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeDiffModal();
});

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Stages (GitLab) — lazy loaded on demand
// ─────────────────────────────────────────────────────────────────────────────
function closeStagesModal() {
  const m = document.getElementById('stages-modal');
  if (m) { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); }
}

async function openStagesModal(projectId, pipelineId, instanceUrl, title) {
  const modal = document.getElementById('stages-modal');
  const body  = document.getElementById('stages-body');
  const hdr   = document.getElementById('stages-modal-title');
  if (!modal || !body) return;

  hdr.textContent = title || `Pipeline #${pipelineId}`;
  body.innerHTML = `<div style="color:var(--muted);padding:.5rem">${_escHtml(t('dash.loading_stages'))}</div>`;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');

  try {
    const q = new URLSearchParams({ project_id: projectId, pipeline_id: String(pipelineId) });
    if (instanceUrl) q.set('instance_url', instanceUrl);
    const r = await fetch(apiUrl('api/pipeline/stages?' + q));
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      body.innerHTML = `<div style="color:var(--fail)">${_escHtml(e.detail || t('dash.stages_load_err'))}</div>`;
      return;
    }
    const data = await r.json();
    const stages = data.stages || [];
    if (!stages.length) {
      body.innerHTML = `<div style="color:var(--muted)">${_escHtml(t('dash.stages_no_jobs'))}</div>`;
      return;
    }

    const JOB_CLS = { success: 'sj-ok', failed: 'sj-fail', running: 'sj-run', canceled: 'sj-skip', skipped: 'sj-skip', pending: 'sj-run' };
    const JOB_ICO = { success: '✓', failed: '✗', running: '▶', canceled: '■', skipped: '–', pending: '⧖' };
    const STATUS_ORD = { failed: 0, running: 1, pending: 2, success: 3, canceled: 4, skipped: 5 };

    body.innerHTML = stages.map(st => {
      const stageStatus = st.jobs.some(j => j.status === 'failed') ? 'failed'
        : st.jobs.some(j => j.status === 'running') ? 'running'
        : st.jobs.every(j => j.status === 'success') ? 'success' : 'pending';
      const stageColor = { failed: 'var(--fail)', success: 'var(--ok)', running: 'var(--info)' }[stageStatus] || 'var(--muted)';

      const jobsHtml = st.jobs
        .sort((a, b) => (STATUS_ORD[a.status]??9) - (STATUS_ORD[b.status]??9) || a.name.localeCompare(b.name))
        .map(j => {
          const cls = JOB_CLS[j.status] || '';
          const ico = JOB_ICO[j.status] || '?';
          const dur = j.duration ? ` ${Math.round(j.duration)}s` : '';
          const tag = j.web_url ? 'a' : 'span';
          const href = j.web_url ? ` href="${_escHtml(j.web_url)}" target="_blank"` : '';
          return `<${tag}${href} class="stage-job ${cls}" title="${_escHtml(j.status)}${dur}">${ico} ${_escHtml(j.name)}${dur ? `<small style="opacity:.7"> ${dur}</small>` : ''}</${tag}>`;
        }).join('');

      return `<div class="stage-row">
        <div class="stage-label" style="color:${stageColor}">${_escHtml(st.stage)}</div>
        <div class="stage-jobs">${jobsHtml}</div>
      </div>`;
    }).join('');
  } catch (e) {
    body.innerHTML = `<div style="color:var(--fail)">${_escHtml(e.message)}</div>`;
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeStagesModal();
});

// ─────────────────────────────────────────────────────────────────────────────
// Timeline / Event Feed
// ─────────────────────────────────────────────────────────────────────────────
function _tlAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = Date.now();
  const secs = Math.floor((now - d) / 1000);
  if (secs < 60) return secs + 's ago';
  if (secs < 3600) return Math.floor(secs/60) + 'm ago';
  if (secs < 86400) return Math.floor(secs/3600) + 'h ago';
  return Math.floor(secs/86400) + 'd ago';
}

function _persistedToTimelineEv(p) {
  const K = {
    build_fail:     { icon: '✗', cls: 'ti-fail' },
    build_recovered:{ icon: '✓', cls: 'ti-ok' },
    svc_down:       { icon: '✗', cls: 'ti-fail' },
    svc_recovered:  { icon: '✓', cls: 'ti-ok' },
  };
  const m = K[p.kind] || { icon: '●', cls: 'ti-info' };
  return {
    ts: p.ts,
    icon: m.icon,
    cls: m.cls,
    title: p.title || p.kind || 'Event',
    detail: p.detail || '',
    url: p.url || null,
    _prio: 1,
  };
}

function renderTimeline(builds, services, persistedList) {
  const list  = document.getElementById('wrap-tl');
  const count = document.getElementById('tl-count');
  if (!list) return;

  const STATUS_ICON = { success:'✓', failure:'✗', running:'▶', unstable:'⚠', aborted:'■', unknown:'?' };
  const STATUS_CLS  = { success:'ti-ok', failure:'ti-fail', running:'ti-run', unstable:'ti-warn', aborted:'ti-info', unknown:'ti-info' };
  const SVC_ICON    = { up:'✓', down:'✗', degraded:'⚠' };
  const SVC_CLS     = { up:'ti-ok', down:'ti-fail', degraded:'ti-warn' };

  const events = [];

  (persistedList || []).forEach(p => events.push(_persistedToTimelineEv(p)));

  builds.forEach(b => {
    if (!b.started_at) return;
    events.push({
      ts: b.started_at,
      icon: STATUS_ICON[b.status] || '?',
      cls:  STATUS_CLS[b.status]  || 'ti-info',
      title: `${b.source} / ${b.job_name} #${b.build_number || '?'}`,
      detail: `${b.status}${b.branch ? ' · ' + b.branch : ''}${b.duration_seconds ? ' · ' + dur(b.duration_seconds) : ''}`,
      url: b.url,
      _prio: 0,
    });
  });

  services.filter(s => s.status !== 'up').forEach(sv => {
    if (!sv.checked_at) return;
    events.push({
      ts: sv.checked_at,
      icon: SVC_ICON[sv.status] || '?',
      cls:  SVC_CLS[sv.status]  || 'ti-info',
      title: `${sv.kind}: ${sv.name}`,
      detail: sv.detail || sv.status,
      url: null,
      _prio: 0,
    });
  });

  events.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')) || ((b._prio || 0) - (a._prio || 0)));

  const seen = new Set();
  const deduped = [];
  for (const ev of events) {
    const k = `${(ev.title || '').slice(0, 120)}|${String(ev.ts || '').slice(0, 16)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(ev);
    if (deduped.length >= 220) break;
  }

  if (!deduped.length) {
    list.innerHTML = '<div style="padding:1rem;color:var(--muted);font-size:.85rem">No events yet — run Collect first.</div>';
    if (count) count.textContent = '0';
    return;
  }

  list.innerHTML = deduped.slice(0, 200).map(ev => `
    <div class="tl-item">
      <div class="tl-icon ${_escHtml(ev.cls)}">${_escHtml(ev.icon)}</div>
      <div class="tl-body">
        <div class="tl-title">${ev.url ? `<a href="${_escHtml(ev.url)}" target="_blank" style="color:inherit;text-decoration:none;hover:underline">${_escHtml(ev.title)}</a>` : _escHtml(ev.title)}</div>
        <div class="tl-detail">${_escHtml(ev.detail)}</div>
      </div>
      <div class="tl-time">${_tlAgo(ev.ts)}</div>
    </div>`).join('');

  if (count) count.textContent = String(deduped.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// Flaky Detection + Failure Correlation
// ─────────────────────────────────────────────────────────────────────────────
let _flakyPanelVisible = true;
function toggleFlakyPanel() {
  _flakyPanelVisible = !_flakyPanelVisible;
  const body = document.getElementById('flaky-body');
  const btn  = document.getElementById('expand-flaky-panel');
  if (body) body.style.display = _flakyPanelVisible ? '' : 'none';
  if (btn)  btn.textContent = _flakyPanelVisible ? t('dash.map_hide') : t('dash.map_show');
}

function analyzeFlaky(builds) {
  // Group builds per job, sorted oldest→newest
  const byJob = {};
  builds.forEach(b => {
    (byJob[b.job_name] = byJob[b.job_name] || []).push(b);
  });
  Object.values(byJob).forEach(arr => arr.sort((a, b) => (a.started_at||'') < (b.started_at||'') ? -1 : 1));

  const flaky = [];
  for (const [job, runs] of Object.entries(byJob)) {
    if (runs.length < 3) continue;
    const statuses = runs.map(r => r.status).filter(s => ['success','failure'].includes(s));
    if (statuses.length < 3) continue;
    let flips = 0;
    for (let i = 1; i < statuses.length; i++) {
      if (statuses[i] !== statuses[i-1] && ['success','failure'].includes(statuses[i])) flips++;
    }
    const flipRate = flips / (statuses.length - 1);
    if (flipRate >= 0.4 && flips >= 2) {
      const src = runs[0].source;
      const lastRun = runs[runs.length - 1];
      flaky.push({ job, src, flips, total: statuses.length, flipRate, lastStatus: lastRun.status, lastRun });
    }
  }
  flaky.sort((a, b) => b.flipRate - a.flipRate || b.flips - a.flips);
  return flaky;
}

function analyzeCorrelation(builds) {
  // One incident per event (requested): each failed/unstable build becomes its own incident.
  const items = (builds || [])
    .filter(b => b && (b.status === 'failure' || b.status === 'unstable') && b.started_at)
    .map(b => ({ ...b, _ts: new Date(b.started_at).getTime() }))
    .filter(b => !isNaN(b._ts))
    .sort((a, b) => b._ts - a._ts); // newest first

  return items.map(b => ({
    start: b.started_at,
    count: 1,
    jobs: [b.job_name],
    sources: [b.source],
  }));
}

function renderFlakyAndCorrelation(builds, dbFlakyItems, flakyErr) {
  const errBox = document.getElementById('flaky-fetch-error');
  if (errBox) {
    if (flakyErr) {
      errBox.style.display = 'flex';
      errBox.innerHTML = `<span>${esc(flakyErr)}</span><button type="button" class="btn btn-ghost" onclick="loadSummary()">${t('common.retry')}</button>`;
    } else {
      errBox.style.display = 'none';
      errBox.innerHTML = '';
    }
  }

  const flakyList  = document.getElementById('flaky-list');
  const incList    = document.getElementById('incident-list');
  const panel      = document.getElementById('panel-flaky');
  const countEl    = document.getElementById('flaky-count');
  const statEl     = document.getElementById('s-flaky');

  let flaky = analyzeFlaky(builds);
  const dbList = (dbFlakyItems || []).map(x => ({
    job: x.job,
    src: x.src,
    flips: x.flips,
    total: x.total,
    flipRate: x.flip_rate != null ? x.flip_rate : x.flipRate,
    lastStatus: x.last_status != null ? x.last_status : x.lastStatus,
    lastRun: null,
    fromDb: true,
  }));
  for (const d of dbList) {
    const i = flaky.findIndex(f => f.job === d.job);
    if (i < 0) {
      flaky.push(d);
      continue;
    }
    if (d.flipRate > flaky[i].flipRate) {
      flaky[i].flipRate = d.flipRate;
      flaky[i].flips = Math.max(flaky[i].flips, d.flips);
      flaky[i].total = Math.max(flaky[i].total, d.total);
    }
  }
  flaky.sort((a, b) => b.flipRate - a.flipRate || b.flips - a.flips);

  const incidents = analyzeCorrelation(builds);

  if (statEl) statEl.textContent = flaky.length;

  if (!flaky.length && !incidents.length) {
    if (panel) panel.style.display = 'none';
    return;
  }
  if (panel) panel.style.display = '';
  if (countEl) countEl.textContent = flaky.length;

  // Flaky list
  if (flakyList) {
    if (!flaky.length) {
      flakyList.innerHTML = '';
    } else {
      flakyList.innerHTML = flaky.map(f => {
        const pct = Math.round(f.flipRate * 100);
        const cls = f.lastStatus === 'failure' ? 'c-fail' : 'c-ok';
        return `<div style="display:flex;align-items:center;gap:.5rem;padding:.3rem 0;border-bottom:1px solid var(--border)">
          <span class="b b-purple" style="font-size:.7rem" title="${_svgTitleAttr(t('flaky.badge_title'))}">${esc(t('flaky.badge'))}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.83rem">
            <strong>${_escHtml(f.src)}</strong> / ${_escHtml(f.job)}
          </span>
          <span style="font-size:.75rem;color:var(--muted)">${esc(tf('flaky.flips_runs', { flips: f.flips, total: f.total }))}</span>
          <span style="font-size:.75rem;color:#a855f7">${esc(tf('flaky.flip_rate', { pct }))}</span>
          <span class="${cls}" style="font-size:.75rem">${_escHtml(f.lastStatus)}</span>
          <button class="btn btn-ghost" style="font-size:.7rem;padding:.15rem .4rem" onclick='filterBuilds("","",${JSON.stringify(f.job)})'>${esc(t('dash.action_view'))}</button>
        </div>`;
      }).join('');
    }
  }

  // Incident correlation
  if (incList) {
    if (!incidents.length) {
      incList.innerHTML = '';
    } else {
      const MAX_INC = 10;
      const shown = incidents.slice(0, MAX_INC);
      const more = Math.max(0, incidents.length - shown.length);
      const hdr = `<div style="padding:.3rem 1rem .1rem;font-size:.8rem;font-weight:700;color:var(--fail);display:flex;align-items:center;gap:.35rem;flex-wrap:wrap">&#9888; <span>${t('incident.correlated_title')}</span><button type="button" class="glossary-hint" title="${_svgTitleAttr(t('glossary.incidents'))}">?</button></div>`;
      incList.innerHTML = hdr + shown.map(inc => `
        <div class="incident-card">
          <div class="incident-title">&#128683; ${inc.count} ${esc(t('incident.within_10'))} — ${_tlAgo(inc.start)}</div>
          <div class="incident-jobs">${esc(t('incident.jobs_lbl'))}: ${inc.jobs.map(j => `<strong>${_escHtml(j)}</strong>`).join(', ')}</div>
          <div class="incident-jobs" style="margin-top:.15rem">${esc(t('incident.sources_lbl'))}: ${inc.sources.map(s => _escHtml(s)).join(', ')}</div>
        </div>`).join('') + (more ? `<div style="padding:.35rem 1rem;color:var(--muted);font-size:.78rem">+${more} more</div>` : '');
    }
  }

  // Add flaky badges to builds table rows
  setTimeout(() => {
    const flakyJobs = new Set(flaky.map(f => f.job));
    document.querySelectorAll('#tbody-builds tr[data-job]').forEach(tr => {
      const jn = decodeURIComponent(tr.getAttribute('data-job') || '');
      if (!jn || !flakyJobs.has(jn) || tr.querySelector('.flaky-badge')) return;
      const jobCell = tr.querySelector('td:nth-child(3)');
      if (!jobCell) return;
      tr.classList.add('flaky-row');
      jobCell.insertAdjacentHTML('beforeend', `<span class="flaky-badge" title="${_svgTitleAttr(t('flaky.badge_title'))}">${esc(t('flaky.badge'))}</span>`);
    });
  }, 300);
}

// ─────────────────────────────────────────────────────────────────────────────
// Uptime / SLA bars
// ─────────────────────────────────────────────────────────────────────────────
async function loadUptimeData() {
  try {
    const r = await fetch(apiUrl('api/uptime?days=30'));
    if (r.ok) _uptimeData = await r.json();
  } catch { /* uptime optional */ }
  updateExecHealthLine();
}

function _svcUptimeBar(name) {
  const history = _uptimeData[name];
  if (!history || !history.length) {
    return `<span style="color:var(--muted);font-size:.7rem">${esc(t('dash.uptime_no_history'))}</span>`;
  }
  const SEG_CLS = { up: 'us-ok', down: 'us-down', degraded: 'us-deg' };
  const okDays = history.filter(h => h.status === 'up').length;
  const pct = Math.round((okDays / history.length) * 100);
  const segs = history.map(h =>
    `<span class="uptime-seg ${SEG_CLS[h.status] || 'us-none'}" title="${_escHtml(h.date)}: ${_escHtml(h.status)}"></span>`
  ).join('');
  return `<div style="display:flex;align-items:center;gap:0">
    <div class="uptime-bar">${segs}</div>
    <span class="uptime-pct" style="color:${pct>=99?'var(--ok)':pct>=90?'var(--warn)':'var(--fail)'}">${pct}%</span>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build Duration Sparklines
// ─────────────────────────────────────────────────────────────────────────────
let _jobSparkData = {}; // job_name → [{d: sec, s: status}] oldest→newest

function _buildSparkData(builds) {
  _jobSparkData = {};
  // Group & sort by started_at ascending (oldest first)
  const sorted = [...builds].sort((a, b) => (a.started_at || '') < (b.started_at || '') ? -1 : 1);
  sorted.forEach(b => {
    if (b.duration_seconds == null) return;
    if (!_jobSparkData[b.job_name]) _jobSparkData[b.job_name] = [];
    const arr = _jobSparkData[b.job_name];
    if (arr.length >= 20) arr.shift(); // keep last 20
    arr.push({ d: b.duration_seconds, s: b.status });
  });
}

function _sparkSVG(jobName, currentStatus) {
  const raw = _jobSparkData[jobName];
  if (!raw || raw.length < 2) return '';
  const pts = raw.slice(-10); // last 10 runs

  const W = 56, H = 16, PAD = 1.5;
  const durations = pts.map(p => p.d);
  const max = Math.max(...durations, 1);
  const min = Math.min(...durations, 0);
  const range = max - min || 1;
  const n = pts.length;

  const xs = pts.map((_, i) => PAD + (n > 1 ? (i / (n - 1)) : 0.5) * (W - 2 * PAD));
  const ys = pts.map(p => PAD + (1 - (p.d - min) / range) * (H - 2 * PAD));

  const pointsAttr = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const dotColor = _statusColorHex(currentStatus);
  const lx = xs[n - 1].toFixed(1), ly = ys[n - 1].toFixed(1);

  return `<svg width="${W}" height="${H}" style="display:block;margin-top:2px;overflow:visible" title="${_svgTitleAttr(t('hint.sparkline') + ' (' + n + ')')}">` +
    `<polyline points="${pointsAttr}" fill="none" stroke="#475569" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<circle cx="${lx}" cy="${ly}" r="2.5" fill="${dotColor}" stroke="var(--surface)" stroke-width="1"/>` +
    `</svg>`;
}

let _sparkDebounce = null;
function scheduleSparklineFetch(jobNames) {
  clearTimeout(_sparkDebounce);
  const jobs = [...new Set((jobNames || []).filter(Boolean))].slice(0, 40);
  if (!jobs.length) return;
  _sparkDebounce = setTimeout(() => {
    fetch(apiUrl('api/analytics/sparklines?jobs=' + encodeURIComponent(jobs.join(','))))
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data || typeof data !== 'object') return;
        Object.entries(data).forEach(([job, pts]) => {
          if (pts && pts.length >= 2)
            _jobSparkData[job] = pts.map(p => ({ d: p.d, s: p.s }));
        });
        refreshBuildSparkCells();
      })
      .catch(() => {});
  }, 450);
}

function refreshBuildSparkCells() {
  document.querySelectorAll('#tbody-builds tr[data-job], #tbody-fav tr[data-job]').forEach(tr => {
    let job;
    try { job = decodeURIComponent(tr.getAttribute('data-job') || ''); } catch { return; }
    if (!job) return;
    const durCell = tr.querySelector('td.td-duration');
    if (!durCell) return;
    const durEl = durCell.querySelector('.dur-val');
    const durText = durEl ? durEl.textContent : '—';
    const st = (tr.querySelector('td:nth-child(5) .b')?.getAttribute('data-status') || tr.querySelector('td:nth-child(5) .b')?.textContent || '').trim().toLowerCase();
    durCell.innerHTML = '<span class="dur-val">' + _escHtml(durText) + '</span>' + _sparkSVG(job, st);
  });
}

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

function setLiveMode(on) {
  _liveMode = !!on;
  try { localStorage.setItem('cimon-live', _liveMode ? '1' : '0'); } catch { /* ignore */ }
  document.body.classList.toggle('dashboard-live', _liveMode);
  const w = document.getElementById('live-toggle-wrap');
  if (w) w.classList.toggle('is-live', _liveMode);
  // Tie server-side auto-collect to the LIVE toggle.
  try {
    fetch(apiUrl('api/collect/auto'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: _liveMode }),
    }).catch(() => null);
  } catch { /* ignore */ }
  applyLivePollingIntervals();
}

// ─────────────────────────────────────────────────────────────────────────────
// Source filter dropdown population
// ─────────────────────────────────────────────────────────────────────────────
async function populateSources() {
  const res = await fetch(apiUrl('api/sources')).catch(()=>null);
  if (!res || !res.ok) return;
  const sources = await res.json();
  const sel = document.getElementById('f-source');
  if (!sel) return;
  // Rebuild options every time (sources can change after Collect / settings updates).
  const cur = sel.value;
  while (sel.options.length > 1) sel.remove(1); // keep "All sources"
  sources.forEach(src => {
    const opt = document.createElement('option');
    opt.value = src; opt.textContent = src;
    sel.appendChild(opt);
  });
  // Keep current selection if still present.
  if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
  updateFilterSummary();
}

async function populateInstances() {
  const res = await fetch(apiUrl('api/instances')).catch(()=>null);
  if (!res || !res.ok) return;
  const items = await res.json();
  const sel = document.getElementById('f-instance');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">All instances</option>`;
  (items || []).forEach((it) => {
    const name = (it && it.name) ? String(it.name) : '';
    if (!name) return;
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });
  if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
}

/** Instance options must exist before restoring LS/URL filters (avoids stale instance hiding builds). */
async function populateSourcesAndInstances() {
  await populateInstances();
  await populateSources();
  _maybeRestoreFiltersFromLS();
  _pruneInvalidBuildInstanceFilter();
  updateFilterSummary();
}

function _pruneInvalidBuildInstanceFilter() {
  const sel = document.getElementById('f-instance');
  if (!sel || !sel.value) return;
  if ([...sel.options].some((o) => o.value === sel.value)) return;
  sel.value = '';
  try { localStorage.removeItem('cimon-f-instance'); } catch { /* ignore */ }
  _writeURLFilters();
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme (dark / light)
// ─────────────────────────────────────────────────────────────────────────────
function _applyTheme(theme) {
  document.documentElement.classList.toggle('light', theme === 'light');
  const btn = document.getElementById('btn-theme');
  if (btn) btn.setAttribute('title', theme === 'light' ? t('dash.theme_light_hint') : t('dash.theme_dark_hint'));
  if (btn) btn.textContent = theme === 'light' ? '🌙' : '☀';
}
function toggleTheme() {
  const next = document.documentElement.classList.contains('light') ? 'dark' : 'light';
  localStorage.setItem('cimon-theme', next);
  _applyTheme(next);
  // Redraw chart.js charts with new colors
  _trendsCharts.forEach(c => c && c.update());
}

// ─────────────────────────────────────────────────────────────────────────────
// Compact mode
// ─────────────────────────────────────────────────────────────────────────────
function toggleCompact() {
  const on = document.body.classList.toggle('compact');
  localStorage.setItem('cimon-compact', on ? '1' : '');
  const btn = document.getElementById('btn-compact');
  if (btn) {
    btn.style.opacity = on ? '1' : '';
    btn.style.background = on ? 'var(--info)' : '';
    btn.style.color = on ? '#fff' : '';
    btn.setAttribute('title', on ? t('dash.compact') : t('dash.compact_off'));
    btn.setAttribute('aria-label', on ? t('dash.compact') : t('dash.compact_off'));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV Export (current builds, all pages)
// ─────────────────────────────────────────────────────────────────────────────
async function exportCSV() {
  const source = document.getElementById('f-source')?.value || '';
  const inst   = document.getElementById('f-instance')?.value || '';
  const status = document.getElementById('f-bstatus')?.value || '';
  const job    = document.getElementById('f-job')?.value || '';
  let url = apiUrl(`api/builds?page=1&per_page=10000&source=${encodeURIComponent(source)}&instance=${encodeURIComponent(inst)}&status=${encodeURIComponent(status)}&job=${encodeURIComponent(job)}`);
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) { showToast(t('dash.export_failed'), 'err'); return; }
  const data = await res.json();
  const rows = data.items || [];
  if (!rows.length) { showToast(t('dash.export_none'), 'err'); return; }
  const cols = ['source','job_name','build_number','status','branch','started_at','duration_seconds','url'];
  const lines = [cols.join(',')];
  rows.forEach(r => lines.push(cols.map(c => {
    const v = r[c] ?? '';
    return `"${String(v).replace(/"/g,'""')}"`;
  }).join(',')));
  const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `builds_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  showToast(`${t('dash.export_ok')} ${rows.length} ${t('dash.rows')}`, 'ok');
}

// ─────────────────────────────────────────────────────────────────────────────
// Deep links — sync URL query params ↔ filter inputs
// ─────────────────────────────────────────────────────────────────────────────
const _FILTER_PARAMS = [
  { id:'f-source', key:'source' },
  { id:'f-instance', key:'instance' },
  { id:'f-bstatus', key:'status' },
  { id:'f-job',    key:'job' },
  { id:'f-tstatus',key:'tstatus' },
  { id:'f-tname',  key:'tname' },
  { id:'f-tsuite', key:'tsuite' },
  { id:'f-fname',  key:'fname' },
  { id:'f-fsuite', key:'fsuite' },
  { id:'f-svstatus', key:'svstatus' },
];

function updateFilterSummary() {
  const fb = [];
  const fs = document.getElementById('f-source');
  const fi = document.getElementById('f-instance');
  const st = document.getElementById('f-bstatus');
  const fj = document.getElementById('f-job');
  if (fs && fs.value) fb.push(`${t('dash.th_source')}: ${fs.value}`);
  if (fi && fi.value) fb.push(`Instance: ${fi.value}`);
  if (st && st.value) fb.push(`${t('dash.th_status')}: ${st.value}`);
  if (fj && fj.value) fb.push(`${t('dash.th_job')}: ${fj.value}`);
  if (_buildsHours === 24) fb.push('24h');
  if (_buildsHours === 168) fb.push('7d');
  const elb = document.getElementById('filter-active-builds');
  const elbTxt = document.getElementById('filter-active-builds-txt');
  if (elb) {
    if (fb.length) {
      elb.style.display = 'block';
      if (elbTxt) elbTxt.textContent = `${t('dash.active_filters')}: ${fb.join(' · ')}`;
    } else {
      elb.style.display = 'none';
      if (elbTxt) elbTxt.textContent = '';
    }
  }
  const ff = [];
  const fn = document.getElementById('f-fname');
  const fsu = document.getElementById('f-fsuite');
  if (fn && fn.value) ff.push(`${t('dash.th_test_name')}: ${fn.value}`);
  if (fsu && fsu.value) ff.push(`${t('dash.th_suite')}: ${fsu.value}`);
  if (_failuresDays > 0) ff.push(tf('dash.failures_last_days', { n: _failuresDays }));
  const elf = document.getElementById('filter-active-failures');
  if (elf) {
    if (ff.length) {
      elf.style.display = 'block';
      elf.textContent = `${t('dash.active_filters')}: ${ff.join(' · ')}`;
    } else {
      elf.style.display = 'none';
      elf.textContent = '';
    }
  }
  const ft = [];
  const fts = document.getElementById('f-tstatus');
  const ftn = document.getElementById('f-tname');
  const ftsuite = document.getElementById('f-tsuite');
  if (fts && fts.value) ft.push(`${t('dash.th_status')}: ${fts.value}`);
  if (ftn && ftn.value) ft.push(`${t('dash.filter_test_ph')}: ${ftn.value}`);
  if (ftsuite && ftsuite.value) ft.push(`${t('dash.th_suite')}: ${ftsuite.value}`);
  if (_testsHours === 6) ft.push('6h');
  if (_testsHours === 24) ft.push('24h');
  if (_testsHours === 168) ft.push('7d');
  const elt = document.getElementById('filter-active-tests');
  const eltTxt = document.getElementById('filter-active-tests-txt');
  if (elt) {
    if (ft.length) {
      elt.style.display = 'block';
      if (eltTxt) eltTxt.textContent = `${t('dash.active_filters')}: ${ft.join(' · ')}`;
    } else {
      elt.style.display = 'none';
      if (eltTxt) eltTxt.textContent = '';
    }
  }
  const fsv = document.getElementById('f-svstatus');
  const svParts = [];
  if (fsv && fsv.value) svParts.push(`${t('dash.th_status')}: ${fsv.value}`);
  const elsv = document.getElementById('filter-active-svcs');
  const elsvTxt = document.getElementById('filter-active-svcs-txt');
  if (elsv) {
    if (svParts.length) {
      elsv.style.display = 'block';
      if (elsvTxt) elsvTxt.textContent = `${t('dash.active_filters')}: ${svParts.join(' · ')}`;
    } else {
      elsv.style.display = 'none';
      if (elsvTxt) elsvTxt.textContent = '';
    }
  }
}

function _persistFiltersFromForm() {
  _FILTER_PARAMS.forEach(({ id, key }) => {
    const el = document.getElementById(id);
    if (el) localStorage.setItem('cimon-f-' + key, el.value);
  });
  _writeURLFilters();
  updateFilterSummary();
}

function _maybeRestoreFiltersFromLS() {
  const p = new URLSearchParams(location.search);
  _FILTER_PARAMS.forEach(({ id, key }) => {
    if (p.has(key)) return;
    const v = localStorage.getItem('cimon-f-' + key);
    const el = document.getElementById(id);
    if (el && v != null && v !== '') el.value = v;
  });
  const bh = localStorage.getItem('cimon-builds-hours');
  if (bh && !p.has('hours')) {
    const h = parseInt(bh, 10);
    if (h === 24 || h === 168) {
      _buildsHours = h;
      document.querySelectorAll('.time-filter-btn').forEach(b => b.classList.remove('active'));
      const id = h === 24 ? 'tf-24h' : 'tf-7d';
      document.getElementById(id)?.classList.add('active');
    }
  }
}

function _readURLFilters() {
  const p = new URLSearchParams(location.search);
  _FILTER_PARAMS.forEach(({id, key}) => {
    const el = document.getElementById(id);
    if (el && p.has(key)) el.value = p.get(key);
  });
}

function _writeURLFilters() {
  const p = new URLSearchParams();
  _FILTER_PARAMS.forEach(({id, key}) => {
    const el = document.getElementById(id);
    if (el && el.value) p.set(key, el.value);
  });
  if (_dashTab && _dashTab !== 'overview') p.set('tab', _dashTab);
  const str = p.toString();
  const h = location.hash || '';
  history.replaceState(null, '', (str ? location.pathname + '?' + str : location.pathname) + h);
}

function _hookFilterURLSync() {
  _FILTER_PARAMS.forEach(({ id }) => {
    const el = document.getElementById(id);
    if (!el) return;
    const evt = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evt, _persistFiltersFromForm);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Trends charts
// ─────────────────────────────────────────────────────────────────────────────
let _trendsCharts = [];
let _trendsViewDays = 14;
let _trendsRawCache = null;
let _trendsRangeActive = false;
let _trendsRangeFrom = '';
let _trendsRangeTo = '';
let _trendsSmooth = 'none';
let _trendsTopN = 10;
let _trendsSource = '';
let _trendsInstSel = { builds: '', tests: '', top: '' };

async function populateTrendsInstanceFilters() {
  const ids = {
    builds: 'trends-inst-builds',
    tests: 'trends-inst-tests',
    top: 'trends-inst-top',
  };
  let items = [];
  try {
    const res = await fetch(apiUrl('api/instances')).catch(() => null);
    if (res && res.ok) items = (await res.json()) || [];
  } catch { /* ignore */ }

  const opts = [{ value: '', label: 'All instances' }];
  (items || []).forEach((it) => {
    const src = String(it.source || '').toLowerCase();
    const name = String(it.name || '').trim();
    if (!src || !name) return;
    opts.push({ value: `${src}|${name}`, label: `${src} · ${name}` });
  });

  Object.entries(ids).forEach(([k, id]) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const saved = (localStorage.getItem('cimon-trends-inst-' + k) || '').trim();
    sel.innerHTML = opts.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
    if (saved && opts.some((o) => o.value === saved)) sel.value = saved;
    sel.addEventListener('change', () => {
      try { localStorage.setItem('cimon-trends-inst-' + k, sel.value || ''); } catch { /* ignore */ }
    }, { passive: true });
  });
}

function _chartColors() {
  const light = document.documentElement.classList.contains('light');
  return {
    grid: light ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.07)',
    text: light ? '#64748b' : '#94a3b8',
  };
}

function _destroyCharts() {
  _trendsCharts.forEach(c => c && c.destroy());
  _trendsCharts = [];
}

function _mkLine(id, labels, datasets, opts) {
  opts = opts || {};
  const {grid, text} = _chartColors();
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return null;
  const yPrec = opts.yPrecision;
  const yTick = {};
  if (yPrec != null) {
    yTick.precision = yPrec;
    yTick.callback = (v) => (typeof v === 'number' ? v.toFixed(yPrec) : v);
  } else {
    yTick.precision = 0;
  }
  const showGrid = opts.showGrid !== false;
  const g = showGrid ? { color: grid } : { display: false };
  const yScale = { beginAtZero: opts.yBeginAtZero !== false, ticks: { color: text, font: { size: 10 }, ...yTick }, grid: g };
  if (opts.yMax != null && typeof opts.yMax === 'number' && !Number.isNaN(opts.yMax) && opts.yMax > 0) {
    yScale.max = opts.yMax;
  }
  return new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { labels: { color: text, boxWidth: 12, font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: text, font: { size: 10 } }, grid: g },
        y: yScale,
      },
    },
  });
}

function _mkBar(id, labels, datasets) {
  const {grid, text} = _chartColors();
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return null;
  return new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { color: text, font: { size: 10 }, precision: 0 }, grid: { color: grid } },
        y: { ticks: { color: text, font: { size: 10 } }, grid: { color: grid } },
      },
    },
  });
}

/** Vertical bar chart (time categories on X) — for custom trends */
function _mkBarV(id, labels, datasets, opts) {
  opts = opts || {};
  const stacked = !!opts.stacked;
  const {grid, text} = _chartColors();
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return null;
  const yPrec = opts.yPrecision;
  const yTick = { color: text, font: { size: 10 } };
  if (yPrec != null) {
    yTick.precision = yPrec;
    yTick.callback = (v) => (typeof v === 'number' ? v.toFixed(yPrec) : v);
  } else {
    yTick.precision = 0;
  }
  const showGrid = opts.showGrid !== false;
  const g = showGrid ? { color: grid } : { display: false };
  const yBar = { stacked, beginAtZero: true, ticks: yTick, grid: g };
  if (opts.yMax != null && typeof opts.yMax === 'number' && !Number.isNaN(opts.yMax) && opts.yMax > 0) {
    yBar.max = opts.yMax;
  }
  return new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { labels: { color: text, boxWidth: 12, font: { size: 11 } } } },
      scales: {
        x: { stacked, ticks: { color: text, font: { size: 10 } }, grid: g },
        y: yBar,
      },
    },
  });
}

const TREND_CUSTOM_LS = 'cimon-trends-custom';
const TREND_CUSTOM_MAX = 12;
const TREND_CUSTOM_MAX_SERIES = 8;
const TREND_METRICS_RAW = ['builds_total', 'builds_failed', 'builds_ok', 'tests_total', 'tests_failed', 'tests_ok', 'services_down'];
const TREND_METRICS_DERIVED = ['builds_fail_pct', 'tests_fail_pct'];
const TREND_METRICS_JOB = ['job_failed', 'job_total'];
const TREND_METRICS_SVC = ['service_down'];
const TREND_METRICS = TREND_METRICS_RAW.concat(TREND_METRICS_DERIVED).concat(TREND_METRICS_JOB).concat(TREND_METRICS_SVC);

function _trendMetricVal(d, key) {
  if (!d || typeof d !== 'object') return 0;
  switch (key) {
    case 'builds_ok': {
      const bt = typeof d.builds_total === 'number' ? d.builds_total : 0;
      const bf = typeof d.builds_failed === 'number' ? d.builds_failed : 0;
      return Math.max(0, bt - bf);
    }
    case 'tests_ok': {
      const tt = typeof d.tests_total === 'number' ? d.tests_total : 0;
      const tf = typeof d.tests_failed === 'number' ? d.tests_failed : 0;
      return Math.max(0, tt - tf);
    }
    case 'builds_fail_pct': {
      const bt = d.builds_total;
      const bf = d.builds_failed;
      if (typeof bt !== 'number' || bt <= 0 || typeof bf !== 'number') return 0;
      return Math.round((1000 * bf) / bt) / 10;
    }
    case 'tests_fail_pct': {
      const tt = d.tests_total;
      const tf = d.tests_failed;
      if (typeof tt !== 'number' || tt <= 0 || typeof tf !== 'number') return 0;
      return Math.round((1000 * tf) / tt) / 10;
    }
    default: {
      const v = d[key];
      return typeof v === 'number' && !Number.isNaN(v) ? v : 0;
    }
  }
}

function _trendLinePointRadius(p) {
  if (p === 'sm') return { r: 2, h: 3 };
  if (p === 'md') return { r: 4, h: 6 };
  return { r: 0, h: 0 };
}

function _trendMetricIsPct(metric) {
  return String(metric || '').endsWith('_fail_pct');
}

function _jobMapVal(d, mapKey, jobName) {
  if (!d || !jobName || typeof d[mapKey] !== 'object') return 0;
  const v = d[mapKey][jobName];
  return typeof v === 'number' && !Number.isNaN(v) ? v : 0;
}
function _serviceDownVal(d, serviceName) {
  if (!d || !d.service_health || !serviceName) return 0;
  const st = String(d.service_health[serviceName] || '').toLowerCase();
  return st === 'down' ? 1 : 0;
}
function _trendSeriesVal(d, s) {
  if (!d || !s) return 0;
  const m = String(s.metric || '');
  if (m === 'job_failed') return _jobMapVal(d, 'job_failures', s.jobName);
  if (m === 'job_total') return _jobMapVal(d, 'job_totals', s.jobName);
  if (m === 'service_down') return _serviceDownVal(d, s.serviceName);
  return _trendMetricVal(d, m);
}
function _movingAvg(arr, w) {
  if (!w || w < 2 || !Array.isArray(arr)) return arr.slice();
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const a = Math.max(0, i - w + 1);
    const slice = arr.slice(a, i + 1);
    out.push(slice.reduce((x, y) => x + y, 0) / slice.length);
  }
  return out;
}
function _smoothSeries(arr, mode) {
  if (mode === 'ma3') return _movingAvg(arr, 3);
  if (mode === 'ma7') return _movingAvg(arr, 7);
  return arr.slice();
}

function loadCustomTrendsConfig() {
  try {
    const raw = localStorage.getItem(TREND_CUSTOM_LS);
    const a = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(a)) return [];
    const out = [];
    for (const x of a) {
      if (!x || typeof x !== 'object') continue;
      const id = String(x.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!id || id.length > 64) continue;
      const title = typeof x.title === 'string' ? x.title.trim().slice(0, 120) : '';
      if (!title) continue;
      const kind = x.kind === 'bar' ? 'bar' : 'line';
      const lineFill = x.lineFill === false ? false : true;
      const linePoints = ['none', 'sm', 'md'].includes(x.linePoints) ? x.linePoints : 'none';
      const barStacked = !!x.barStacked;
      const chartSmooth = ['none', 'ma3', 'ma7'].includes(x.chartSmooth) ? x.chartSmooth : 'none';
      const hideGrid = !!x.hideGrid;
      const lt = parseFloat(x.lineTension, 10);
      let yMax;
      if (x.yMax != null && x.yMax !== '') {
        const yn = parseFloat(x.yMax, 10);
        if (!Number.isNaN(yn) && yn > 0) yMax = yn;
      }
      const series = (Array.isArray(x.series) ? x.series : [])
        .map((s) => {
          if (!s || !TREND_METRICS.includes(String(s.metric))) return null;
          const m = String(s.metric);
          const lab = (s.label && String(s.label).trim()) ? String(s.label).trim().slice(0, 80) : undefined;
          let colorIdx;
          if (s.colorIdx !== undefined && s.colorIdx !== null && s.colorIdx !== '') {
            const n = parseInt(s.colorIdx, 10);
            if (!Number.isNaN(n) && n >= 0 && n <= 4) colorIdx = n;
          }
          const jobName = (s.jobName && String(s.jobName).trim()) ? String(s.jobName).trim().slice(0, 200) : undefined;
          const serviceName = (s.serviceName && String(s.serviceName).trim()) ? String(s.serviceName).trim().slice(0, 200) : undefined;
          if (TREND_METRICS_JOB.includes(m) && !jobName) return null;
          if (m === 'service_down' && !serviceName) return null;
          const o = { metric: m, label: lab, colorIdx };
          if (jobName) o.jobName = jobName;
          if (serviceName) o.serviceName = serviceName;
          return o;
        })
        .filter(Boolean)
        .slice(0, TREND_CUSTOM_MAX_SERIES);
      if (!series.length) continue;
      const entry = { id, title, kind, lineFill, linePoints, barStacked, series, chartSmooth, hideGrid };
      if (!Number.isNaN(lt) && lt >= 0 && lt <= 1) entry.lineTension = lt;
      if (yMax != null) entry.yMax = yMax;
      out.push(entry);
    }
    return out;
  } catch {
    return [];
  }
}

function saveCustomTrendsConfig(arr) {
  localStorage.setItem(TREND_CUSTOM_LS, JSON.stringify(arr));
}

function tcMetricOptionsHtml(selected) {
  const opt = (m) => {
    const sel = m === selected ? ' selected' : '';
    return `<option value="${m}"${sel}>${esc(t('dash.metric_' + m))}</option>`;
  };
  let h = `<optgroup label="${esc(t('dash.trend_metric_group_raw'))}">`;
  h += TREND_METRICS_RAW.map(opt).join('');
  h += `</optgroup><optgroup label="${esc(t('dash.trend_metric_group_derived'))}">`;
  h += TREND_METRICS_DERIVED.map(opt).join('');
  h += `</optgroup><optgroup label="${esc(t('dash.trend_metric_group_job'))}">`;
  h += TREND_METRICS_JOB.map(opt).join('');
  h += `</optgroup><optgroup label="${esc(t('dash.trend_metric_group_svc'))}">`;
  h += TREND_METRICS_SVC.map(opt).join('');
  h += '</optgroup>';
  return h;
}

function tcColorOptionsHtml(selected) {
  const labels = [
    t('dash.trend_custom_color_auto'),
    t('dash.trend_color_info'),
    t('dash.trend_color_fail'),
    t('dash.trend_color_ok'),
    t('dash.trend_color_warn'),
    t('dash.trend_color_purple'),
  ];
  const values = ['', '0', '1', '2', '3', '4'];
  const selNorm = selected === undefined || selected === null ? '' : String(selected);
  return values.map((val, i) => {
    const sel = selNorm === '' ? (i === 0 ? ' selected' : '') : (selNorm === val ? ' selected' : '');
    return `<option value="${val}"${sel}>${esc(labels[i])}</option>`;
  }).join('');
}

function tcAddSeriesRow() {
  const wrap = document.getElementById('tc-series-rows');
  if (!wrap) return;
  if (wrap.querySelectorAll('.tc-series-row').length >= TREND_CUSTOM_MAX_SERIES) {
    showToast(tf('dash.trend_custom_err_series_max', { n: TREND_CUSTOM_MAX_SERIES }), 'warn');
    return;
  }
  const row = document.createElement('div');
  row.className = 'tc-series-row';
  const prevRow = wrap.querySelector('.tc-series-row:last-child');
  const first = wrap.querySelector('.tc-metric');
  const pick = prevRow && prevRow.querySelector('.tc-metric')?.value ? prevRow.querySelector('.tc-metric').value : (first && first.value ? first.value : TREND_METRICS[0]);
  const colSel = prevRow && prevRow.querySelector('.tc-color');
  const colPick = colSel ? colSel.value : '';
  row.innerHTML = `<select class="tc-metric" onchange="tcRowSyncMetric(this.closest('.tc-series-row'))">${tcMetricOptionsHtml(pick)}</select>
    <input type="text" class="tc-job-input" list="tc-job-datalist" style="display:none;flex:1;min-width:min(100%,200px)" maxlength="200" data-i18n-placeholder="dash.trend_job_ph" placeholder="" />
    <input type="text" class="tc-svc-input" list="tc-svc-datalist" style="display:none;flex:1;min-width:min(100%,200px)" maxlength="200" data-i18n-placeholder="dash.trend_svc_ph" placeholder="" />
    <input type="text" class="tc-label" data-i18n-placeholder="dash.trend_custom_legend_ph" placeholder="" />
    <select class="tc-color" title="">${tcColorOptionsHtml(colPick)}</select>
    <button type="button" class="btn btn-ghost" style="font-size:.75rem;padding:.2rem .45rem" onclick="tcRemoveSeriesRow(this)" data-i18n="dash.trend_custom_remove_row">×</button>`;
  wrap.appendChild(row);
  tcRowSyncMetric(row);
  applyUITexts();
}

function tcRowSyncMetric(row) {
  if (!row) return;
  const met = row.querySelector('.tc-metric')?.value || '';
  const ji = row.querySelector('.tc-job-input');
  const si = row.querySelector('.tc-svc-input');
  if (ji) {
    ji.style.display = TREND_METRICS_JOB.includes(met) ? '' : 'none';
  }
  if (si) {
    si.style.display = met === 'service_down' ? '' : 'none';
  }
}

function tcRemoveSeriesRow(btn) {
  const wrap = document.getElementById('tc-series-rows');
  if (!wrap || wrap.querySelectorAll('.tc-series-row').length < 2) return;
  btn.closest('.tc-series-row')?.remove();
}

function tcEnsureSeriesRows() {
  const wrap = document.getElementById('tc-series-rows');
  if (!wrap) return;
  if (wrap.querySelector('.tc-series-row')) return;
  tcAddSeriesRow();
}

function tcSyncTrendModalKindUI() {
  const k = document.getElementById('tc-kind')?.value;
  const lo = document.getElementById('tc-line-opts');
  const bo = document.getElementById('tc-bar-opts');
  if (lo) lo.style.display = k === 'line' ? '' : 'none';
  if (bo) bo.style.display = k === 'bar' ? '' : 'none';
}

let _trendsModalPrevFocus = null;
function refreshTrendsModalDatalists() {
  const raw = _trendsRawCache || [];
  const jobs = new Set();
  const svcs = new Set();
  raw.forEach((d) => {
    Object.keys(d.job_failures || {}).forEach((j) => jobs.add(j));
    Object.keys(d.job_totals || {}).forEach((j) => jobs.add(j));
    Object.keys(d.service_health || {}).forEach((s) => svcs.add(s));
  });
  const escA = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const jdl = document.getElementById('tc-job-datalist');
  const sdl = document.getElementById('tc-svc-datalist');
  if (jdl) jdl.innerHTML = [...jobs].sort().slice(0, 500).map((j) => `<option value="${escA(j)}"></option>`).join('');
  if (sdl) sdl.innerHTML = [...svcs].sort().slice(0, 500).map((s) => `<option value="${escA(s)}"></option>`).join('');
}

function openTrendsChartModal() {
  const ov = document.getElementById('trends-chart-modal');
  if (!ov) return;
  _trendsModalPrevFocus = document.activeElement;
  resetTrendsConstructorForm();
  refreshTrendsModalDatalists();
  tcSyncTrendModalKindUI();
  ov.setAttribute('aria-hidden', 'false');
  ov.classList.add('open');
  requestAnimationFrame(() => document.getElementById('tc-title')?.focus());
}

function closeTrendsChartModal() {
  const ov = document.getElementById('trends-chart-modal');
  if (!ov) return;
  ov.classList.remove('open');
  ov.setAttribute('aria-hidden', 'true');
  try {
    if (_trendsModalPrevFocus && typeof _trendsModalPrevFocus.focus === 'function') _trendsModalPrevFocus.focus();
  } catch { /* ignore */ }
  _trendsModalPrevFocus = null;
}

function resetTrendsConstructorForm() {
  const ti = document.getElementById('tc-title');
  if (ti) ti.value = '';
  const k = document.getElementById('tc-kind');
  if (k) k.value = 'line';
  const lf = document.getElementById('tc-line-fill');
  if (lf) lf.checked = true;
  const lp = document.getElementById('tc-line-points');
  if (lp) lp.value = 'none';
  const br = document.querySelector('input[name="tc-bar-mode"][value="grouped"]');
  if (br) br.checked = true;
  const cs = document.getElementById('tc-chart-smooth');
  if (cs) cs.value = 'none';
  const ym = document.getElementById('tc-y-max');
  if (ym) ym.value = '';
  const hg = document.getElementById('tc-hide-grid');
  if (hg) hg.checked = false;
  const lt = document.getElementById('tc-line-tension');
  if (lt) lt.value = '0.3';
  const wrap = document.getElementById('tc-series-rows');
  if (wrap) {
    wrap.innerHTML = '';
    tcAddSeriesRow();
  }
}

function addCustomTrendChart() {
  const title = (document.getElementById('tc-title')?.value || '').trim();
  const kind = document.getElementById('tc-kind')?.value === 'bar' ? 'bar' : 'line';
  const lineFill = !!document.getElementById('tc-line-fill')?.checked;
  const linePoints = document.getElementById('tc-line-points')?.value || 'none';
  const barStacked = document.querySelector('input[name="tc-bar-mode"]:checked')?.value === 'stacked';
  const rows = document.querySelectorAll('#tc-series-rows .tc-series-row');
  const series = [];
  for (const row of rows) {
    const met = row.querySelector('.tc-metric')?.value;
    const lab = (row.querySelector('.tc-label')?.value || '').trim();
    const jobName = (row.querySelector('.tc-job-input')?.value || '').trim();
    const serviceName = (row.querySelector('.tc-svc-input')?.value || '').trim();
    const cRaw = row.querySelector('.tc-color')?.value;
    let colorIdx;
    if (cRaw !== undefined && cRaw !== '') {
      const n = parseInt(cRaw, 10);
      if (!Number.isNaN(n) && n >= 0 && n <= 4) colorIdx = n;
    }
    if (!met || !TREND_METRICS.includes(met)) continue;
    if (TREND_METRICS_JOB.includes(met) && !jobName) {
      showToast(t('dash.trend_custom_err_job'), 'warn');
      return;
    }
    if (met === 'service_down' && !serviceName) {
      showToast(t('dash.trend_custom_err_svc'), 'warn');
      return;
    }
    const o = { metric: met, label: lab || undefined };
    if (colorIdx !== undefined) o.colorIdx = colorIdx;
    if (jobName) o.jobName = jobName;
    if (serviceName) o.serviceName = serviceName;
    series.push(o);
  }
  if (!title) {
    showToast(t('dash.trend_custom_err_title'), 'warn');
    return;
  }
  if (!series.length) {
    showToast(t('dash.trend_custom_err_series'), 'warn');
    return;
  }
  const cf = loadCustomTrendsConfig();
  if (cf.length >= TREND_CUSTOM_MAX) {
    showToast(t('dash.trend_custom_max'), 'warn');
    return;
  }
  const chartSmooth = document.getElementById('tc-chart-smooth')?.value || 'none';
  const yMaxRaw = document.getElementById('tc-y-max')?.value;
  let yMax;
  if (yMaxRaw != null && String(yMaxRaw).trim() !== '') {
    const yn = parseFloat(yMaxRaw, 10);
    if (!Number.isNaN(yn) && yn > 0) yMax = yn;
  }
  const hideGrid = !!document.getElementById('tc-hide-grid')?.checked;
  const lineTension = parseFloat(document.getElementById('tc-line-tension')?.value || '0.3', 10);
  const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const entry = { id, title, kind, series, chartSmooth: ['none', 'ma3', 'ma7'].includes(chartSmooth) ? chartSmooth : 'none', hideGrid };
  if (yMax != null) entry.yMax = yMax;
  if (kind === 'line') {
    entry.lineFill = lineFill;
    entry.linePoints = ['none', 'sm', 'md'].includes(linePoints) ? linePoints : 'none';
    if (!Number.isNaN(lineTension) && lineTension >= 0 && lineTension <= 1) entry.lineTension = lineTension;
  }
  if (kind === 'bar') entry.barStacked = barStacked;
  cf.push(entry);
  saveCustomTrendsConfig(cf);
  closeTrendsChartModal();
  if (_trendsRawCache && _trendsRawCache.length) renderTrendsFromCache();
  else loadTrends(_trendsViewDays, null);
}

function removeCustomTrendChart(id) {
  const sid = String(id || '');
  const cf = loadCustomTrendsConfig().filter((c) => c.id !== sid);
  saveCustomTrendsConfig(cf);
  if (_trendsRawCache && _trendsRawCache.length) renderTrendsFromCache();
  else loadTrends(_trendsViewDays, null);
}

function renderCustomTrendChartCards() {
  const wrap = document.getElementById('trends-custom-grid');
  const heading = document.getElementById('trends-custom-heading');
  if (!wrap) return;
  const configs = loadCustomTrendsConfig();
  if (!configs.length) {
    wrap.innerHTML = '';
    if (heading) heading.style.display = 'none';
    return;
  }
  if (heading) heading.style.display = '';
  wrap.innerHTML = configs
    .map((cfg) => {
      const sid = String(cfg.id);
      const stitle = esc(cfg.title);
      return `<div class="chart-card chart-card-custom" id="chart-card-custom-${sid}">
      <button type="button" class="chart-zoom-btn" onclick="toggleChartFullscreen('chart-card-custom-${sid}',-1)" data-i18n-title="dash.zoom_chart" title="">&#x2922;</button>
      <button type="button" class="chart-del-btn" onclick="removeCustomTrendChart('${sid}')" data-i18n-title="dash.trend_custom_remove_chart" title="">&#10005;</button>
      <h3>${stitle}</h3>
      <canvas id="chart-custom-${sid}"></canvas>
    </div>`;
    })
    .join('');
  applyUITexts();
}

function buildCustomTrendCharts(data, labels) {
  const palette = ['--info', '--st-failure', '--st-success', '--warn', '--purple'];
  const out = [];
  loadCustomTrendsConfig().forEach((cfg) => {
    const cid = 'chart-custom-' + cfg.id;
    const anyPct = cfg.series.some((s) => _trendMetricIsPct(s.metric));
    const yPrecision = anyPct ? 1 : 0;
    const lineFill = cfg.lineFill !== false;
    const linePts = _trendLinePointRadius(cfg.linePoints || 'none');
    const lt = parseFloat(cfg.lineTension, 10);
    const tension = cfg.kind === 'line' && !Number.isNaN(lt) && lt >= 0 && lt <= 1 ? lt : 0.3;
    const sm = cfg.chartSmooth || 'none';
    const hideGrid = !!cfg.hideGrid;
    const yMax = cfg.yMax;
    const datasets = cfg.series.map((s, i) => {
      const pi = typeof s.colorIdx === 'number' && s.colorIdx >= 0 && s.colorIdx <= 4 ? s.colorIdx : (i % palette.length);
      const col = _cssVar(palette[pi]);
      let defLabel = t('dash.metric_' + s.metric);
      if (TREND_METRICS_JOB.includes(s.metric) && s.jobName) defLabel = `${defLabel}: ${s.jobName}`;
      if (s.metric === 'service_down' && s.serviceName) defLabel = `${defLabel}: ${s.serviceName}`;
      const label = (s.label && s.label.trim()) ? s.label.trim() : defLabel;
      let vals = data.map((d) => _trendSeriesVal(d, s));
      if (sm === 'ma3') vals = _movingAvg(vals, 3);
      else if (sm === 'ma7') vals = _movingAvg(vals, 7);
      const base = {
        label,
        data: vals,
        borderColor: col,
        backgroundColor: cfg.kind === 'bar' ? _hexToRgba(col, 0.55) : _hexToRgba(col, 0.12),
        tension: cfg.kind === 'line' ? tension : 0,
        fill: cfg.kind === 'line' && lineFill,
      };
      if (cfg.kind === 'bar') base.borderWidth = 1;
      if (cfg.kind === 'line') {
        base.pointRadius = linePts.r;
        base.pointHoverRadius = linePts.h;
      }
      return base;
    });
    const chartOpts = { yPrecision, showGrid: !hideGrid, yMax };
    let ch;
    if (cfg.kind === 'bar') {
      ch = _mkBarV(cid, labels, datasets, { stacked: !!cfg.barStacked, yPrecision, showGrid: !hideGrid, yMax });
    } else {
      ch = _mkLine(cid, labels, datasets, chartOpts);
    }
    if (ch) out.push(ch);
    const node = document.getElementById(cid);
    if (node) {
      node.setAttribute('role', 'img');
      node.setAttribute('aria-label', cfg.title);
    }
  });
  return out;
}

function setTrendsSize(size, btn) {
  const wrap = document.getElementById('wrap-trends');
  if (!wrap) return;
  wrap.setAttribute('data-size', size);
  document.querySelectorAll('.trends-size-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  localStorage.setItem('cimon-trends-size', size);
  requestAnimationFrame(() => _trendsCharts.forEach(c => c && c.resize()));
}

function toggleChartFullscreen(cardId, chartIndex) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const wasFs = card.classList.contains('chart-fs');
  document.querySelectorAll('.chart-card.chart-fs').forEach(c => c.classList.remove('chart-fs'));
  if (!wasFs) card.classList.add('chart-fs');
  requestAnimationFrame(() => {
    _trendsCharts.forEach(c => c && c.resize());
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.querySelector('.chart-card.chart-fs')) {
    document.querySelectorAll('.chart-card.chart-fs').forEach(c => c.classList.remove('chart-fs'));
    requestAnimationFrame(() => _trendsCharts.forEach(c => c && c.resize()));
  }
});

function getTrendsViewData() {
  const raw = _trendsRawCache;
  if (!raw || !raw.length) return [];
  let view = raw;
  if (_trendsRangeActive && _trendsRangeFrom && _trendsRangeTo && _trendsRangeFrom <= _trendsRangeTo) {
    view = view.filter((d) => d.date >= _trendsRangeFrom && d.date <= _trendsRangeTo);
  } else {
    const n = Math.min(_trendsViewDays, view.length);
    view = view.slice(-n);
  }

  const src = (_trendsSource || '').trim().toLowerCase();
  if (!src) return view;

  // Override totals used by default charts using per-source breakdowns (if present in history).
  return view.map((e) => {
    const be = (e && typeof e === 'object') ? e : {};
    const bsrc = (be.builds_by_source && be.builds_by_source[src]) ? be.builds_by_source[src] : null;
    const tsrc = (be.tests_by_source && be.tests_by_source[src]) ? be.tests_by_source[src] : null;
    const topBySrc = (be.top_test_failures_by_source && be.top_test_failures_by_source[src])
      ? be.top_test_failures_by_source[src]
      : null;
    return {
      ...be,
      builds_total: bsrc && typeof bsrc.total === 'number' ? bsrc.total : be.builds_total,
      builds_failed: bsrc && typeof bsrc.failed === 'number' ? bsrc.failed : be.builds_failed,
      tests_total: tsrc && typeof tsrc.total === 'number' ? tsrc.total : be.tests_total,
      tests_failed: tsrc && typeof tsrc.failed === 'number' ? tsrc.failed : be.tests_failed,
      top_test_failures: Array.isArray(topBySrc) ? topBySrc : be.top_test_failures,
    };
  });
}

function renderTrendsFromCache() {
  renderTrendsChartsFromData(getTrendsViewData());
}

function onTrendsSmoothChange(el) {
  _trendsSmooth = el && el.value ? el.value : 'none';
  localStorage.setItem('cimon-trends-smooth', _trendsSmooth);
  if (_trendsRawCache && _trendsRawCache.length) renderTrendsFromCache();
}

function onTrendsTopNChange(el) {
  let n = parseInt(el && el.value, 10);
  if (!Number.isFinite(n)) n = 10;
  n = Math.min(100, Math.max(3, n));
  _trendsTopN = n;
  if (el && 'value' in el) el.value = String(n);
  try { localStorage.setItem('cimon-trends-topn', String(_trendsTopN)); } catch { /* ignore */ }
  if (_trendsRawCache && _trendsRawCache.length) renderTrendsFromCache();
}

function onTrendsSourceChange(el) {
  _trendsSource = el && typeof el.value === 'string' ? el.value.trim().toLowerCase() : '';
  try { localStorage.setItem('cimon-trends-source', _trendsSource); } catch { /* ignore */ }
  if (_trendsRawCache && _trendsRawCache.length) renderTrendsFromCache();
}

function applyTrendsDateRange() {
  const df = document.getElementById('trends-d-from')?.value;
  const dt = document.getElementById('trends-d-to')?.value;
  if (!df || !dt || df > dt) {
    showToast(t('dash.trends_range_invalid'), 'warn');
    return;
  }
  _trendsRangeFrom = df;
  _trendsRangeTo = dt;
  _trendsRangeActive = true;
  localStorage.setItem('cimon-trends-rfrom', df);
  localStorage.setItem('cimon-trends-rto', dt);
  document.querySelectorAll('.trend-period-btn').forEach((b) => b.classList.remove('active'));
  void loadTrends(_trendsViewDays, null);
}

function clearTrendsDateRange() {
  _trendsRangeActive = false;
  _trendsRangeFrom = '';
  _trendsRangeTo = '';
  localStorage.removeItem('cimon-trends-rfrom');
  localStorage.removeItem('cimon-trends-rto');
  const df = document.getElementById('trends-d-from');
  const dt = document.getElementById('trends-d-to');
  if (df) df.value = '';
  if (dt) dt.value = '';
  document.querySelectorAll('.trend-period-btn').forEach((b) => {
    const d = parseInt(b.textContent.trim(), 10);
    b.classList.toggle('active', d === _trendsViewDays);
  });
  if (_trendsRawCache && _trendsRawCache.length) renderTrendsFromCache();
}

window.applyTrendsDateRange = applyTrendsDateRange;
window.clearTrendsDateRange = clearTrendsDateRange;

function initTrendsFiltersFromStorage() {
  const tsm = localStorage.getItem('cimon-trends-smooth');
  if (['none', 'ma3', 'ma7'].includes(tsm)) _trendsSmooth = tsm;
  const elSm = document.getElementById('trends-smooth');
  if (elSm) elSm.value = _trendsSmooth;
  const tsrc = (localStorage.getItem('cimon-trends-source') || '').trim().toLowerCase();
  if (tsrc) _trendsSource = tsrc;
  const elSrc = document.getElementById('trends-source');
  if (elSrc) elSrc.value = _trendsSource;
  const ttn = parseInt(localStorage.getItem('cimon-trends-topn'), 10);
  if (Number.isFinite(ttn) && ttn >= 3 && ttn <= 100) _trendsTopN = ttn;
  const elTn = document.getElementById('trends-topn');
  if (elTn && 'value' in elTn) elTn.value = String(_trendsTopN);
  const elSvKind = document.getElementById('trends-inst-svcs');
  const tsk = (localStorage.getItem('cimon-trends-inst-svcs') || '').trim();
  if (elSvKind && ['', 'docker', 'http', 'other'].includes(tsk)) elSvKind.value = tsk;
  const tp = parseInt(localStorage.getItem('cimon-trends-period'), 10);
  if ([3, 7, 14, 21, 30].includes(tp)) _trendsViewDays = tp;
  const rf = localStorage.getItem('cimon-trends-rfrom');
  const rt = localStorage.getItem('cimon-trends-rto');
  if (rf && rt && rf <= rt) {
    _trendsRangeFrom = rf;
    _trendsRangeTo = rt;
    _trendsRangeActive = true;
    const df = document.getElementById('trends-d-from');
    const dtt = document.getElementById('trends-d-to');
    if (df) df.value = rf;
    if (dtt) dtt.value = rt;
  }
  document.querySelectorAll('.trend-period-btn').forEach((b) => {
    const d = parseInt(b.textContent.trim(), 10);
    b.classList.toggle('active', d === _trendsViewDays && !_trendsRangeActive);
  });
}

function renderTrendsChartsFromData(data) {
  _destroyCharts();
  renderCustomTrendChartCards();
  if (!data.length) {
    document.querySelectorAll('#panel-trends canvas').forEach((c) => {
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.font = '13px system-ui';
      ctx.fillText(t('dash.trends_empty'), c.width / 2, 80);
    });
    return;
  }
  const labels = data.map((d) => d.date);
  const sm = _trendsSmooth;
  const sl = (arr) => _smoothSeries(arr, sm);
  const cInfo = _cssVar('--info');
  const cFail = _cssVar('--st-failure');
  const cOk = _cssVar('--st-success');

  const getInstVal = (id) => (document.getElementById(id)?.value || '').trim();
  const instBuilds = getInstVal('trends-inst-builds');
  const instTests = getInstVal('trends-inst-tests');
  const instTop = getInstVal('trends-inst-top');

  const buildTotals = data.map((d) => {
    if (!instBuilds) return d.builds_total;
    const m = d.builds_by_instance && d.builds_by_instance[instBuilds];
    return m && typeof m.total === 'number' ? m.total : d.builds_total;
  });
  const buildFails = data.map((d) => {
    if (!instBuilds) return d.builds_failed;
    const m = d.builds_by_instance && d.builds_by_instance[instBuilds];
    return m && typeof m.failed === 'number' ? m.failed : d.builds_failed;
  });
  const cBuilds = _mkLine('chart-builds', labels, [
    { label: t('dash.chart_total'), data: sl(buildTotals), borderColor: cInfo, backgroundColor: _hexToRgba(cInfo, 0.12), tension: 0.3, fill: true },
    { label: t('dash.chart_failed'), data: sl(buildFails), borderColor: cFail, backgroundColor: _hexToRgba(cFail, 0.12), tension: 0.3, fill: true },
  ]);

  const instToTestSrc = (v) => (v.startsWith('jenkins|') ? 'jenkins' : v.startsWith('gitlab|') ? 'gitlab' : '');
  const wantTestSrc = instToTestSrc(instTests);
  const testTotalsLine = data.map((d) => {
    if (!wantTestSrc) return d.tests_total;
    const m = d.tests_by_source && d.tests_by_source[wantTestSrc];
    return m && typeof m.total === 'number' ? m.total : d.tests_total;
  });
  const testFailsLine = data.map((d) => {
    if (!wantTestSrc) return d.tests_failed;
    const m = d.tests_by_source && d.tests_by_source[wantTestSrc];
    return m && typeof m.failed === 'number' ? m.failed : d.tests_failed;
  });
  const cTests = _mkLine('chart-tests', labels, [
    { label: t('dash.chart_total'), data: sl(testTotalsLine), borderColor: cOk, backgroundColor: _hexToRgba(cOk, 0.12), tension: 0.3, fill: true },
    { label: t('dash.chart_failed'), data: sl(testFailsLine), borderColor: cFail, backgroundColor: _hexToRgba(cFail, 0.12), tension: 0.3, fill: true },
  ]);

  const svcsKind = (document.getElementById('trends-inst-svcs')?.value || '').trim();
  const svcDownSeries = data.map((d) => {
    if (!svcsKind) return d.services_down;
    const bk = d.services_down_by_kind;
    if (bk && typeof bk[svcsKind] === 'number') return bk[svcsKind];
    return 0;
  });
  const cSvcs = _mkLine('chart-svcs', labels, [
    { label: t('dash.chart_down'), data: sl(svcDownSeries), borderColor: cFail, backgroundColor: _hexToRgba(cFail, 0.2), tension: 0.3, fill: true },
  ]);

  const wantTopSrc = instToTestSrc(instTop);
  const testTotals = {};
  data.forEach((d) => {
    const arr = wantTopSrc && d.top_test_failures_by_source && Array.isArray(d.top_test_failures_by_source[wantTopSrc])
      ? d.top_test_failures_by_source[wantTopSrc]
      : (d.top_test_failures || []);
    (arr || []).forEach(([n, c]) => { testTotals[n] = (testTotals[n] || 0) + c; });
  });
  const topN = Math.min(100, Math.max(3, parseInt(String(_trendsTopN), 10) || 10));
  const topSlice = Object.entries(testTotals).sort((a, b) => b[1] - a[1]).slice(0, topN);
  const cTop = topSlice.length ? _mkBar('chart-top-tests',
    topSlice.map(([n]) => (n.length > 35 ? n.slice(0, 35) + '…' : n)),
    [{ label: t('dash.chart_failures'), data: topSlice.map(([, c]) => c), backgroundColor: _hexToRgba(cFail, 0.7), borderColor: cFail, borderWidth: 1 }]
  ) : null;

  const customCharts = buildCustomTrendCharts(data, labels);
  _trendsCharts = [cBuilds, cTests, cSvcs, cTop, ...customCharts].filter(Boolean);
  [
    ['chart-builds', 'dash.chart_builds'],
    ['chart-tests', 'dash.chart_tests'],
    ['chart-svcs', 'dash.chart_svcs'],
    ['chart-top-tests', 'dash.chart_top'],
  ].forEach(([cid, tkey]) => {
    const node = document.getElementById(cid);
    if (!node) return;
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', t(tkey));
  });
}

function _utcIsoDate() {
  const n = new Date();
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-${String(n.getUTCDate()).padStart(2, '0')}`;
}

/** Inclusive calendar span between two YYYY-MM-DD strings (UTC noon; matches backend trend day_key). */
function _isoYmdInclusiveSpan(a, b) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(b))) return 0;
  const t0 = Date.parse(`${a}T12:00:00.000Z`);
  const t1 = Date.parse(`${b}T12:00:00.000Z`);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return 0;
  return Math.floor((t1 - t0) / 864e5) + 1;
}

/** `days` for /api/trends: cover preset window and custom range start (server uses UTC dates). */
function _trendsApiDaysFetch() {
  const preset = Math.min(730, Math.max(30, Number(_trendsViewDays) || 14));
  let n = preset;
  if (_trendsRangeActive && _trendsRangeFrom && _trendsRangeTo && _trendsRangeFrom <= _trendsRangeTo) {
    const todayUtc = _utcIsoDate();
    const needBack = _isoYmdInclusiveSpan(_trendsRangeFrom, todayUtc);
    n = Math.min(730, Math.max(n, needBack));
  }
  return n;
}

async function loadTrends(days, btn) {
  if (typeof days === 'number') _trendsViewDays = days;
  if (btn) {
    document.querySelectorAll('.trend-period-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    _trendsRangeActive = false;
    const df = document.getElementById('trends-d-from');
    const dt = document.getElementById('trends-d-to');
    if (df) df.value = '';
    if (dt) dt.value = '';
    localStorage.removeItem('cimon-trends-rfrom');
    localStorage.removeItem('cimon-trends-rto');
    localStorage.setItem('cimon-trends-period', String(days));
  }

  const errEl = document.getElementById('trends-error');
  let data;
  try {
    const nd = _trendsApiDaysFetch();
    const res = await fetchKeyed('trends', apiUrl(`api/trends?days=${nd}`)).catch(() => null);
    if (res === FETCH_ABORTED) return;
    if (!res || !res.ok) {
      if (errEl) {
        errEl.style.display = 'flex';
        errEl.innerHTML = `<span>${esc(t('trends_err'))} (HTTP ${res ? res.status : '—'})</span><button type="button" class="btn btn-ghost" onclick="loadTrends(${_trendsViewDays},null)">${t('common.retry')}</button>`;
      }
      return;
    }
    data = await res.json();
  } catch (e) {
    if (errEl) {
      errEl.style.display = 'flex';
      errEl.innerHTML = `<span>${esc(t('trends_err'))}</span><button type="button" class="btn btn-ghost" onclick="loadTrends(${_trendsViewDays},null)">${t('common.retry')}</button>`;
    }
    return;
  }
  _trendsRawCache = Array.isArray(data) ? data : [];
  if (errEl) {
    errEl.style.display = 'none';
    errEl.innerHTML = '';
  }
  renderTrendsChartsFromData(getTrendsViewData());
}

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
      // Reset all panels to page 1
      Object.values(_state).forEach((s) => {
        s.page = 1;
        s.done = false;
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
  initBackToTop();
  document.getElementById('ic-open-logs')?.addEventListener('click', icOpenFirstFailureLog);
  [
    ['btn-collect', 'dash.collect'],
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

  const tcm = document.getElementById('trends-chart-modal');
  if (tcm) {
    tcm.addEventListener('click', (e) => { if (e.target === tcm) closeTrendsChartModal(); });
  }
  document.getElementById('trends-modal-close')?.addEventListener('click', closeTrendsChartModal);
  document.getElementById('trends-modal-cancel')?.addEventListener('click', closeTrendsChartModal);
  document.getElementById('trends-modal-save')?.addEventListener('click', addCustomTrendChart);
  document.getElementById('tc-kind')?.addEventListener('change', tcSyncTrendModalKindUI);
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
      if (e.key >= '1' && e.key <= '7' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const idx = parseInt(e.key, 10) - 1;
        if (DASH_TABS[idx]) {
          e.preventDefault();
          setDashboardTab(DASH_TABS[idx]);
        }
      }
    }
    if (e.key !== 'Escape') return;
    const ov = document.getElementById('trends-chart-modal');
    if (ov && ov.classList.contains('open')) closeTrendsChartModal();
    const rb = document.getElementById('runbook-modal');
    if (rb && rb.classList.contains('open')) closeRunbook();
  });

  const pTab = new URLSearchParams(location.search).get('tab');
  let initTab = (pTab && DASH_TABS.includes(pTab)) ? pTab : (localStorage.getItem('cimon-dash-tab') || 'overview');
  if (!DASH_TABS.includes(initTab)) initTab = 'overview';
  setDashboardTab(initTab, { skipUrl: true });

  // Set up IntersectionObserver for each panel's scroll sentinel
  _initObserver('builds',   loadBuilds);
  _initObserver('failures', loadFailures);
  _initObserver('tests',    loadTests);
  _initObserver('svcs',     loadServices);

  // Render starred builds panel
  _renderFavPanel();

  // Initial data load (dropdowns restore filters from localStorage — run before table loads)
  pollCollect();
  loadUptimeData().then(() => loadServices()); // load uptime before services render
  loadSummary();
  populateSourcesAndInstances().then(() => {
    loadBuilds();
    loadFailures();
    loadTests();
  });
  // Trends: size first, then load data (charts pick up --trend-chart-h)
  const tsz = localStorage.getItem('cimon-trends-size') || 'm';
  const szBtn = document.querySelector(`.trends-size-btn[data-size="${tsz}"]`);
  setTrendsSize(tsz, szBtn || document.querySelector('.trends-size-btn[data-size="m"]'));
  initTrendsFiltersFromStorage();
  populateTrendsInstanceFilters();
  loadTrends(_trendsViewDays, null);

  const chkLive = document.getElementById('chk-live-mode');
  if (chkLive) {
    chkLive.checked = localStorage.getItem('cimon-live') === '1';
    _liveMode = chkLive.checked;
    document.body.classList.toggle('dashboard-live', _liveMode);
    const liveWrap = document.getElementById('live-toggle-wrap');
    if (liveWrap) liveWrap.classList.toggle('is-live', _liveMode);
    chkLive.addEventListener('change', () => setLiveMode(chkLive.checked));
  }
  applyLivePollingIntervals({ skipInitialFullRefresh: true });
});

// ── Action helpers ─────────────────────────────────────────────────────────
function showToast(msg, type = 'ok') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), 5000);
  srAnnounce(msg, type === 'err' ? 'assertive' : 'polite');
}

/** Beautiful confirm dialog. kind: jenkins | gitlab | docker */
function openActionConfirm(opts) {
  return new Promise((resolve) => {
    const ov = document.getElementById('action-modal');
    const icon = document.getElementById('modal-icon');
    const title = document.getElementById('modal-title');
    const sub = document.getElementById('modal-sub');
    const wrap = document.getElementById('modal-target-wrap');
    const tLabel = document.getElementById('modal-target-label');
    const tText = document.getElementById('modal-target-text');
    const meta = document.getElementById('modal-meta');
    const okBtn = document.getElementById('modal-ok');
    const cancelBtn = document.getElementById('modal-cancel');

    const kind = opts.kind || 'jenkins';
    icon.className = 'modal-icon ' + kind;
    icon.innerHTML = kind === 'jenkins' ? '&#128296;' : kind === 'gitlab' ? '&#129347;' : '&#128051;';

    title.textContent = opts.title || t('dash.action_confirm');
    sub.textContent = opts.subtitle || '';
    tLabel.textContent = opts.targetLabel || t('dash.modal_target');
    tText.textContent = opts.targetText || '';
    wrap.style.display = opts.targetText ? 'block' : 'none';
    meta.innerHTML = opts.metaHtml || '';

    okBtn.textContent = opts.okText || t('dash.action_confirm');
    if (cancelBtn) cancelBtn.textContent = t('dash.action_cancel');
    okBtn.className = opts.dangerOk
      ? 'modal-btn modal-btn-ok danger'
      : 'modal-btn modal-btn-ok ' + kind;

    // Branch input (for GitLab pipeline)
    const branchWrap  = document.getElementById('modal-branch-wrap');
    const branchInput = document.getElementById('modal-branch-input');
    if (opts.branchValue !== undefined) {
      branchWrap.style.display = '';
      branchInput.value = opts.branchValue || 'main';
    } else {
      branchWrap.style.display = 'none';
    }

    const cleanup = () => {
      ov.classList.remove('open');
      ov.setAttribute('aria-hidden', 'true');
      document.removeEventListener('keydown', onKey);
    };
    const finish = (yes) => {
      cleanup();
      resolve(yes ? { confirmed: true, branch: branchInput.value.trim() || 'main' } : null);
    };

    const onKey = (e) => { if (e.key === 'Escape') finish(null); };

    document.getElementById('modal-cancel').onclick = () => finish(null);
    okBtn.onclick = () => finish(true);
    ov.onclick = (e) => { if (e.target === ov) finish(null); };

    const onEnter = (e) => { if (e.key === 'Enter' && document.activeElement === branchInput) finish(true); };
    branchInput.addEventListener('keydown', onEnter);

    document.addEventListener('keydown', onKey);
    ov.setAttribute('aria-hidden', 'false');
    ov.classList.add('open');
    requestAnimationFrame(() => okBtn.focus());
  });
}

async function triggerJenkinsBuild(btn, jobName) {
  const r = await openActionConfirm({
    kind: 'jenkins',
    title: t('dash.act_jenkins_title'),
    subtitle: t('dash.act_jenkins_sub'),
    targetLabel: t('dash.act_target_job'),
    targetText: jobName,
    okText: t('dash.act_jenkins_ok'),
  });
  if (!r) return;
  btn.classList.add('running');
  btn.innerHTML = '&#9203; ' + t('dash.act_running');
  try {
    const res = await fetch(apiUrl('api/action/jenkins/build'), {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({job_name: jobName}),
    });
    if (res.ok) {
      showToast(tf('dash.act_jenkins_queued', { name: jobName }), 'ok');
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(tf('dash.act_fail', { detail: err.detail || res.statusText }), 'err');
    }
  } catch(e) { showToast(tf('dash.act_err', { msg: e.message }), 'err'); }
  btn.classList.remove('running');
  btn.innerHTML = '&#9654; ' + t('dash.act_run');
}

async function triggerGitlabPipeline(btn, projectId, ref) {
  const r = await openActionConfirm({
    kind: 'gitlab',
    title: t('dash.act_gitlab_title'),
    subtitle: t('dash.act_gitlab_sub'),
    targetLabel: t('dash.act_target_project'),
    targetText: projectId,
    branchValue: ref || 'main',
    okText: t('dash.act_gitlab_ok'),
  });
  if (!r) return;
  const branch = r.branch || ref || 'main';
  btn.classList.add('running');
  btn.innerHTML = '&#9203; ' + t('dash.act_running');
  try {
    const res = await fetch(apiUrl('api/action/gitlab/pipeline'), {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({project_id: projectId, ref: branch}),
    });
    if (res.ok) {
      const data = await res.json();
      const msg = data.web_url
        ? tf('dash.act_gitlab_toast_linked', { url: data.web_url })
        : t('dash.act_gitlab_toast_queued');
      showToast(msg, 'ok');
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(tf('dash.act_fail', { detail: err.detail || res.statusText }), 'err');
    }
  } catch(e) { showToast(tf('dash.act_err', { msg: e.message }), 'err'); }
  btn.classList.remove('running');
  btn.innerHTML = '&#9654; ' + t('dash.act_run');
}

function _dockerConfirmOpts(action, containerName) {
  const base = {
    kind: 'docker',
    targetLabel: t('dash.act_target_container'),
    targetText: containerName,
  };
  if (action === 'start') {
    return {
      ...base,
      title: t('dash.act_docker_start_title'),
      subtitle: t('dash.act_docker_start_sub'),
      okText: t('dash.act_docker_start_ok'),
      dangerOk: false,
    };
  }
  if (action === 'stop') {
    return {
      ...base,
      title: t('dash.act_docker_stop_title'),
      subtitle: t('dash.act_docker_stop_sub'),
      okText: t('dash.act_docker_stop_ok'),
      dangerOk: true,
    };
  }
  return {
    ...base,
    title: t('dash.act_docker_restart_title'),
    subtitle: t('dash.act_docker_restart_sub'),
    okText: t('dash.act_docker_restart_ok'),
    dangerOk: false,
  };
}

async function dockerContainerAction(btn, containerName, action) {
  const cfg = _dockerConfirmOpts(action, containerName);
  const r = await openActionConfirm(cfg);
  if (!r) return;

  const group = btn.closest('.act-group');
  if (group) group.classList.add('busy');

  const labels = { start: t('dash.act_docker_busy_start'), stop: t('dash.act_docker_busy_stop'), restart: t('dash.act_docker_busy_restart') };
  const orig = btn.innerHTML;
  btn.classList.add('running');
  btn.innerHTML = '&#9203; ' + (labels[action] || '…');

  try {
    const res = await fetch(apiUrl('api/action/docker/container'), {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ container_name: containerName, action }),
    });
    if (res.ok) {
      const data = await res.json();
      const st = data.status || '';
      const verbKey = { start: 'dash.act_docker_verb_start', stop: 'dash.act_docker_verb_stop', restart: 'dash.act_docker_verb_restart' }[action];
      const verb = verbKey ? t(verbKey) : action;
      showToast(tf('dash.act_docker_toast', { verb, name: containerName, extra: st ? ` (${st})` : '' }), 'ok');
      resetServices(true);
    } else {
      const err = await res.json().catch(() => ({}));
      const detail = err.detail || res.statusText;
      if (res.status === 429) showToast(tf('dash.act_rate_limit', { detail }), 'err');
      else showToast(tf('dash.act_fail', { detail }), 'err');
    }
  } catch (e) {
    showToast(tf('dash.act_err', { msg: e.message }), 'err');
  }

  btn.classList.remove('running');
  btn.innerHTML = orig;
  if (group) group.classList.remove('busy');
}

// ─────────────────────────────────────────────────────────────────────────────
// Global search (client-side — filters loaded DOM rows across all tables)
// ─────────────────────────────────────────────────────────────────────────────
let _gsQuery = '';

/** Lowercased text used for matching (textContent + key row attributes). */
function _globalSearchRowHaystack(tr) {
  let s = (tr.textContent || '').toLowerCase();
  const dj = tr.getAttribute('data-job');
  if (dj) {
    try { s += ' ' + decodeURIComponent(dj).toLowerCase(); } catch { s += ' ' + dj.toLowerCase(); }
  }
  const dfj = tr.getAttribute('data-fav-job');
  if (dfj) s += ' ' + String(dfj).toLowerCase();
  return s;
}

function globalSearch(q) {
  _gsQuery = (q || '').toLowerCase().trim();
  const clearBtn = document.getElementById('global-search-clear');
  if (clearBtn) clearBtn.classList.toggle('visible', !!_gsQuery);

  const tbodies = ['tbody-builds','tbody-failures','tbody-tests','tbody-svcs','tbody-fav'];
  tbodies.forEach(id => {
    const tbody = document.getElementById(id);
    if (!tbody) return;
    Array.from(tbody.querySelectorAll('tr')).forEach(tr => {
      if (tr.classList.contains('empty-row') || tr.classList.contains('load-more-row')) return;
      // Build group headers: match is decided after data rows (headers rarely contain job names).
      if (id === 'tbody-builds' && tr.classList.contains('src-group-row') && _gsQuery) return;
      const hay = _globalSearchRowHaystack(tr);
      const matches = !_gsQuery || hay.includes(_gsQuery);
      tr.classList.toggle('row-hidden-search', !matches);
    });
  });

  const tbodyBuilds = document.getElementById('tbody-builds');
  if (tbodyBuilds) {
    tbodyBuilds.querySelectorAll('tr.gs-reveal-match').forEach((tr) => tr.classList.remove('gs-reveal-match'));
    if (_gsQuery) {
      tbodyBuilds.querySelectorAll('tr[data-bgroup]:not(.src-group-row)').forEach((tr) => {
        if (tr.classList.contains('empty-row') || tr.classList.contains('load-more-row')) return;
        if (!tr.classList.contains('row-hidden-search')) tr.classList.add('gs-reveal-match');
      });
      const groupHasVisible = {};
      tbodyBuilds.querySelectorAll('tr[data-bgroup]:not(.src-group-row)').forEach((tr) => {
        if (tr.classList.contains('empty-row') || tr.classList.contains('load-more-row')) return;
        const g = tr.getAttribute('data-bgroup');
        if (!g) return;
        if (!tr.classList.contains('row-hidden-search')) groupHasVisible[g] = true;
      });
      tbodyBuilds.querySelectorAll('tr.src-group-row[data-bgroup]').forEach((tr) => {
        const g = tr.getAttribute('data-bgroup');
        tr.classList.toggle('row-hidden-search', !groupHasVisible[g]);
      });
    } else {
      tbodyBuilds.querySelectorAll('tr.src-group-row').forEach((tr) => tr.classList.remove('row-hidden-search'));
      try {
        _collapsedBuildGroups.forEach((enc) => applyBuildGroupVisibility(enc));
      } catch { /* ignore */ }
    }
  }
}

function clearGlobalSearch() {
  const inp = document.getElementById('global-search');
  if (inp) inp.value = '';
  globalSearch('');
}

// Re-apply search after rows are loaded
function _applyGlobalSearch() {
  const inp = document.getElementById('global-search');
  globalSearch(inp ? inp.value : '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────────
let _notifMaxId = 0;
let _notifSeen = 0;

function toggleNotifPanel() {
  const p = document.getElementById('notif-panel');
  p.classList.toggle('open');
  if (p.classList.contains('open')) {
    _notifSeen = _notifMaxId;
    _updateNotifBadge(0);
  }
  // Close when clicking outside
  if (p.classList.contains('open')) {
    setTimeout(() => {
      document.addEventListener('click', _notifOutsideClick, {once: true});
    }, 0);
  }
}

function _notifOutsideClick(e) {
  const p = document.getElementById('notif-panel');
  const btn = document.getElementById('notif-btn');
  if (!p || p.contains(e.target) || btn.contains(e.target)) return;
  p.classList.remove('open');
}

function _updateNotifBadge(count) {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
  }
}

function clearNotifications() {
  const list = document.getElementById('notif-list');
  if (list) list.innerHTML = '<div class="notif-empty">No state-change events yet</div>';
  _notifMaxId = 0; _notifSeen = 0;
  _updateNotifBadge(0);
}

function _renderNotifItem(n) {
  const levelClass = n.level === 'ok' ? 'ok' : n.level === 'warn' ? 'warn' : 'error';
  const ts = n.ts ? new Date(n.ts).toLocaleTimeString() : '';
  const link = n.url ? ` <a href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener" style="font-size:.72rem">&#8599;</a>` : '';
  return `<div class="notif-item">
    <div class="notif-dot ${levelClass}"></div>
    <div class="notif-item-body">
      <div class="notif-item-title">${esc(n.title)}${link}</div>
      <div class="notif-item-detail">${esc(n.detail || '')}</div>
    </div>
    <div class="notif-item-ts">${ts}</div>
  </div>`;
}

async function pollNotifications() {
  const res = await fetch(apiUrl(`api/notifications?since_id=${_notifMaxId}`)).catch(() => null);
  if (!res || !res.ok) return;
  const data = await res.json();
  if (!data.items || !data.items.length) return;

  const list = document.getElementById('notif-list');
  const panel = document.getElementById('notif-panel');
  const wasEmpty = list.querySelector('.notif-empty');

  if (wasEmpty) list.innerHTML = '';

  data.items.forEach(n => {
    list.insertAdjacentHTML('afterbegin', _renderNotifItem(n));
    if (n.id > _notifMaxId) _notifMaxId = n.id;
  });

  const newCount = _notifMaxId - _notifSeen;
  if (newCount > 0 && !panel.classList.contains('open')) {
    _updateNotifBadge(newCount);
    // Show a toast for each new critical notification
    data.items.filter(n => n.level === 'error').forEach(n => {
      showToast(n.title, 'err');
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Favourites (starred builds, stored in localStorage)
// ─────────────────────────────────────────────────────────────────────────────
const FAV_KEY = 'cimon-favourites';
let _favBuilds = {};   // job_name -> build object

function _favDecodeJobAttr(enc) {
  try { return decodeURIComponent(enc || ''); } catch { return ''; }
}

/** Favourite toggle from builds table (avoids broken onclick HTML when job_name is a string). */
function toggleFavBtn(btn) {
  if (!btn) return;
  const jobName = _favDecodeJobAttr(btn.getAttribute('data-fav-job'));
  if (!jobName) return;
  let buildData = null;
  const pl = btn.getAttribute('data-fav-payload');
  if (pl) {
    try { buildData = JSON.parse(_favDecodeJobAttr(pl)); } catch { buildData = { job_name: jobName }; }
  }
  // Immediate visual feedback on the clicked button (even if storage/UI refresh fails).
  const was = btn.classList.contains('starred');
  try { toggleFav(jobName, buildData); }
  catch {
    btn.classList.toggle('starred', !was);
    btn.title = !was ? t('dash.fav_remove') : t('dash.fav_add');
  }
}

function _loadFavKeys() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '{}'); }
  catch { return {}; }
}

function _saveFavKeys(obj) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(obj)); } catch { /* ignore */ }
}

function toggleFav(jobName, buildData) {
  const k = String(jobName ?? '');
  const keys = _loadFavKeys();
  if (keys[k]) {
    delete keys[k];
    showToast(tf('dash.fav_removed_toast', { name: k }), 'ok');
  } else {
    keys[k] = buildData || { job_name: k };
    showToast(tf('dash.starred_toast', { name: k }), 'ok');
  }
  _saveFavKeys(keys);
  _renderFavPanel();
  // Update star buttons visible in builds table
  document.querySelectorAll('.fav-btn[data-fav-job]').forEach((btn) => {
    const jn = _favDecodeJobAttr(btn.getAttribute('data-fav-job'));
    btn.classList.toggle('starred', !!keys[jn]);
    btn.title = keys[jn] ? t('dash.fav_remove') : t('dash.fav_add');
  });
}

function _buildFavRow(b) {
  const src = (b.source || '').toLowerCase();
  let actionBtn = '';
  if (src === 'jenkins') {
    actionBtn = `<button class="act-btn" onclick="triggerJenkinsBuild(this,${JSON.stringify(b.job_name)})">&#9654; ${esc(t('dash.act_run'))}</button>`;
  } else if (src === 'gitlab') {
    const ref = b.branch || 'main';
    actionBtn = `<button class="act-btn" onclick="triggerGitlabPipeline(this,${JSON.stringify(b.job_name)},${JSON.stringify(ref)})">&#9654; ${esc(t('dash.act_run'))}</button>`;
  }
  const ctx = _fmtBuildContext(_jobAnalytics[b.job_name]);
  const jt = _svgTitleAttr(b.job_name);
  const bt = _svgTitleAttr(b.branch || '');
  const cpyTitle = _svgTitleAttr(t('dash.copy_id_title'));
  const bn = b.build_number;
  const numHtml = (bn != null && bn !== '')
    ? `<span class="num-copy-wrap"><span>${esc(String(bn))}</span><button type="button" class="btn-copy-ref" title="${cpyTitle}" aria-label="${cpyTitle}" onclick="copyBuildRef(event,${JSON.stringify(b.job_name)},${JSON.stringify(bn)})">&#128203;</button></span>`
    : '—';
  return `<tr data-fav-job="${esc(b.job_name)}" data-job="${encodeURIComponent(b.job_name)}">
    <td class="col-pin-star"><button type="button" class="fav-btn starred" data-fav-job="${encodeURIComponent(String(b.job_name ?? ''))}" onclick="toggleFavBtn(this)" title="${_svgTitleAttr(t('dash.fav_remove'))}">&#11088;</button></td>
    <td class="col-pin-src"><span class="b b-dim">${esc(b.source)}</span></td>
    <td class="col-pin-job" style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${jt}">
      ${b.critical ? `<strong>${esc(b.job_name)}</strong>` : esc(b.job_name)}
    </td>
    <td class="mono col-pin-num">${numHtml}</td>
    <td class="col-pin-st">${badge(b.status)}</td>
    <td class="mono context-cell col-compact-hide" style="font-size:.76rem;color:var(--muted);max-width:140px">${ctx}</td>
    <td class="mono col-compact-hide" style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${bt}">${esc(b.branch)}</td>
    <td style="white-space:nowrap">${fmt(b.started_at)}</td>
    <td class="td-duration" style="white-space:nowrap"><span class="dur-val">${dur(b.duration_seconds)}</span>${_sparkSVG(b.job_name, b.status)}</td>
    <td>${b.url ? `<a href="${esc(safeUrl(b.url))}" target="_blank" rel="noopener">&#8599;</a>` : '—'}</td>
    <td>${_buildLogCell(b)}</td>
    <td>${actionBtn}</td>
  </tr>`;
}

function _renderFavPanel() {
  const keys = _loadFavKeys();
  const panel = document.getElementById('panel-favourites');
  const tbody = document.getElementById('tbody-fav');
  const count = document.getElementById('fav-count');
  const entries = Object.values(keys);

  if (!panel) return;
  panel.classList.toggle('has-items', entries.length > 0);
  if (count) count.textContent = entries.length;

  if (!tbody) return;
  if (!entries.length) { tbody.innerHTML = ''; return; }
  tbody.innerHTML = entries.map(b => _buildFavRow(b)).join('');
  _applyGlobalSearch();
}

// ─────────────────────────────────────────────────────────────────────────────
// Time filter (hours) for builds
// ─────────────────────────────────────────────────────────────────────────────
let _buildsHours = 0;
let _testsHours = 0;
/** Top failures panel: 0 = whole snapshot, else last N days by test timestamp */
let _failuresDays = 0;
let _svcProblemsOnly = false;
let _persistedEvents = [];
let _lastSnap = null;
let _topAgeBaseSec = null;
let _topAgeBaseTs = 0;
let _topAgeStale = false;
let _topAgeTimer = null;

function _syncURLAndFilterSummary() {
  try { _writeURLFilters(); } catch { /* ignore */ }
  try { updateFilterSummary(); } catch { /* ignore */ }
}

function toggleTestsTimeFilter(hours) {
  const wasActive = _testsHours === hours;
  _testsHours = wasActive ? 0 : hours;
  ['tf-t-6h','tf-t-24h','tf-t-7d'].forEach((id) => document.getElementById(id)?.classList.remove('active'));
  if (!wasActive) {
    const id = hours === 6 ? 'tf-t-6h' : hours === 24 ? 'tf-t-24h' : 'tf-t-7d';
    document.getElementById(id)?.classList.add('active');
  }
  try { localStorage.setItem('cimon-tests-hours', String(_testsHours)); } catch {}
  updateFilterSummary();
  resetFailures();
  resetTests();
}

function setTestSourceQuick(v) {
  const sel = document.getElementById('f-tsource');
  if (!sel) return;
  sel.value = v;
  updateTestsExportLinks();
  _syncTestSourceQuickButtons();
  resetFailures();
  resetTests();
}

function _syncTestSourceQuickButtons() {
  const v = document.getElementById('f-tsource')?.value || '';
  const b1 = document.getElementById('tsrc-real');
  const b2 = document.getElementById('tsrc-synth');
  if (b1) b1.classList.toggle('lv-active', v === 'real');
  if (b2) b2.classList.toggle('lv-active', v === 'synthetic');
}

function toggleTimeFilter(hours) {
  const wasActive = _buildsHours === hours;
  _buildsHours = wasActive ? 0 : hours;

  document.querySelectorAll('.time-filter-btn').forEach(b => b.classList.remove('active'));
  if (!wasActive) {
    const id = hours === 24 ? 'tf-24h' : 'tf-7d';
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }
  try {
    localStorage.setItem('cimon-builds-hours', String(_buildsHours));
  } catch { /* ignore */ }
  updateFilterSummary();
  resetBuilds();
}

function applyBuildPreset(preset) {
  if (preset === 'failed24') {
    document.getElementById('f-bstatus').value = 'failure';
    _buildsHours = 24;
    document.querySelectorAll('.time-filter-btn').forEach((b) => b.classList.remove('active'));
    document.getElementById('tf-24h')?.classList.add('active');
    try { localStorage.setItem('cimon-builds-hours', '24'); } catch { /* ignore */ }
    resetBuilds();
    updateFilterSummary();
    goToInTab('builds', 'panel-builds');
  } else if (preset === 'starred') {
    document.getElementById('f-source').value = '';
    document.getElementById('f-bstatus').value = '';
    document.getElementById('f-job').value = '';
    _buildsHours = 0;
    document.querySelectorAll('.time-filter-btn').forEach((b) => b.classList.remove('active'));
    try { localStorage.setItem('cimon-builds-hours', '0'); } catch { /* ignore */ }
    resetBuilds();
    updateFilterSummary();
    goToInTab('builds', 'panel-favourites');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export dropdown toggle
// ─────────────────────────────────────────────────────────────────────────────
function toggleExportMenu(wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const isOpen = wrap.classList.toggle('open');
  if (isOpen) {
    setTimeout(() => {
      document.addEventListener('click', function close(e) {
        if (!wrap.contains(e.target)) { wrap.classList.remove('open'); }
        document.removeEventListener('click', close);
      });
    }, 0);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Log viewer (Jenkins / GitLab / Docker + follow + search)
// ─────────────────────────────────────────────────────────────────────────────
let _logAbort = null;
let _logRawText = '';
let _logSearchQuery = '';
let _logLevelFilter = 'all';
let _logSearchRegex = false;
let _logIsStreaming = false;
let _logSearchTimer = null;
let _logStreamRenderTimer = null;

function _onLogRegexToggle() {
  const el = document.getElementById('log-search-regex');
  _logSearchRegex = !!(el && el.checked);
  _renderLogLines();
}

function _escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _setLogText(text) {
  _logRawText = text || '';
  _logIsStreaming = false;
  _renderLogLines();
}

function _appendLogChunk(chunk) {
  _logRawText += chunk;
  clearTimeout(_logStreamRenderTimer);
  _logStreamRenderTimer = setTimeout(() => {
    const pre = document.getElementById('log-modal-pre');
    if (!pre) return;
    if (!_logSearchQuery && _logLevelFilter === 'all') {
      // Fast path during streaming — plain text, no re-parse
      pre.textContent = _logRawText;
      pre.scrollTop = pre.scrollHeight;
    } else {
      _renderLogLines();
    }
  }, 250);
}

function _renderLogLines() {
  const pre = document.getElementById('log-modal-pre');
  if (!pre) return;
  const qRaw = (_logSearchQuery || '').trim();
  const q = qRaw.toLowerCase();
  const lvl = _logLevelFilter;
  const NOISE_404 = [
    'http://127.0.0.1:8000/api/collect/status',
    'http://127.0.0.1:8000/api/notifications?since_id=0',
  ];

  // Fast path: no filters and large log → plain text
  if (!q && lvl === 'all' && _logRawText.length > 400000) {
    pre.textContent = _logRawText;
    if (_logIsStreaming) pre.scrollTop = pre.scrollHeight;
    const cnt = document.getElementById('log-search-count');
    if (cnt) cnt.textContent = '';
    return;
  }

  const lines = _logRawText.split('\n');
  const parts = [];
  let matchCount = 0;

  const ERR_RE = /\b(error|exception|fail(?:ed|ure)?|fatal|critical|traceback)\b/i;
  const WARN_RE = /\b(warn(?:ing)?|deprecated)\b/i;
  const INFO_RE = /\b(info|debug|verbose|trace)\b/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLower = line.toLowerCase();
    // Hide noisy internal poll 404s (common when app isn't bound on 127.0.0.1 inside container).
    if (lineLower.includes('http исключение 404') && NOISE_404.some(u => lineLower.includes(u))) continue;

    if (lvl !== 'all') {
      const isErr = ERR_RE.test(line);
      const isWarn = WARN_RE.test(line);
      const isInfo = INFO_RE.test(line);
      if (lvl === 'error' && !isErr) continue;
      if (lvl === 'warn' && !isWarn && !isErr) continue;
      if (lvl === 'info' && !isInfo && !isWarn && !isErr) continue;
    }

    if (qRaw) {
      if (_logSearchRegex) {
        let re;
        try { re = new RegExp(qRaw); } catch { continue; }
        if (!re.test(line)) continue;
      } else if (!lineLower.includes(q)) {
        continue;
      }
    }

    const isErr = ERR_RE.test(line);
    const isWarn = WARN_RE.test(line);
    const cls = isErr ? 'log-line-err' : isWarn ? 'log-line-warn' : '';

    let escaped = _escHtml(line);

    if (qRaw) {
      if (_logSearchRegex) {
        matchCount++;
        try {
          const reHl = new RegExp(qRaw, 'g');
          let m;
          const pieces = [];
          let last = 0;
          let any = false;
          while ((m = reHl.exec(line)) !== null) {
            any = true;
            pieces.push(_escHtml(line.slice(last, m.index)));
            pieces.push('<mark class="log-hl">' + _escHtml(m[0]) + '</mark>');
            last = m.index + m[0].length;
            if (m[0].length === 0) reHl.lastIndex++;
          }
          pieces.push(_escHtml(line.slice(last)));
          if (any) escaped = pieces.join('');
        } catch { /* keep plain escaped line */ }
      } else {
        matchCount++;
        const qEscHtml = _escHtml(qRaw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        escaped = escaped.replace(new RegExp(qEscHtml, 'gi'), m => `<mark class="log-hl">${m}</mark>`);
      }
    }

    parts.push(cls ? `<span class="${cls}">${escaped}</span>\n` : `${escaped}\n`);
  }

  pre.innerHTML = parts.length
    ? parts.join('')
    : `<span style="color:var(--muted)">(no lines match filter)</span>`;

  const cnt = document.getElementById('log-search-count');
  if (cnt) cnt.textContent = qRaw ? `${matchCount} match${matchCount !== 1 ? 'es' : ''}` : '';

  if (_logIsStreaming) pre.scrollTop = pre.scrollHeight;

  // Scroll first match into view
  if (qRaw) {
    const mark = pre.querySelector('mark.log-hl');
    if (mark) mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function _onLogSearch(val) {
  clearTimeout(_logSearchTimer);
  _logSearchTimer = setTimeout(() => {
    _logSearchQuery = val;
    _renderLogLines();
  }, 200);
}

function setLogLevel(lvl) {
  _logLevelFilter = lvl;
  // Only buttons inside the log modal (same class is reused for Tests "Real/Jobs" toggles).
  document.querySelectorAll('#log-modal .log-lvl-btn[data-level]').forEach((b) => {
    b.classList.remove('lv-active', 'lv-active-err', 'lv-active-warn');
    if (b.dataset.level === lvl) {
      b.classList.add(lvl === 'error' ? 'lv-active-err' : lvl === 'warn' ? 'lv-active-warn' : 'lv-active');
    }
  });
  _renderLogLines();
}

function _resetLogSearch() {
  _logRawText = '';
  _logSearchQuery = '';
  _logLevelFilter = 'all';
  _logSearchRegex = false;
  _logIsStreaming = false;
  clearTimeout(_logSearchTimer);
  clearTimeout(_logStreamRenderTimer);
  const inp = document.getElementById('log-search-input');
  if (inp) inp.value = '';
  const rx = document.getElementById('log-search-regex');
  if (rx) rx.checked = false;
  const cnt = document.getElementById('log-search-count');
  if (cnt) cnt.textContent = '';
  document.querySelectorAll('#log-modal .log-lvl-btn[data-level]').forEach((b) => {
    b.classList.remove('lv-active', 'lv-active-err', 'lv-active-warn');
    if (b.dataset.level === 'all') b.classList.add('lv-active');
  });
}

function copyLogToClipboard() {
  navigator.clipboard.writeText(_logRawText).then(
    () => showToast(t('dash.copy_log_toast'), 'ok'),
    () => showToast(t('dash.copy_log_fail'), 'err')
  );
}

function _formatLogFetchError(r, data, rawText) {
  const d = data && data.detail;
  if (r.status === 404) {
    if (d === 'Not Found' || d === undefined) {
      return 'HTTP 404 «Not Found»: запрос ушёл не на тот URL (часто из-за абсолютного пути /api при открытии дашборда не с корня сайта). Обновите страницу (Ctrl+F5). Если за nginx — location должен проксировать тот же префикс, что и у страницы (например /monitor/api/…).';
    }
    if (typeof d === 'string' && d.indexOf('Container not found') === 0) {
      return d + '\n\nПодсказка: веб-сервис и collect должны использовать один и тот же Docker (см. docker ps -a). Имя в таблице могло устареть — нажмите Collect.';
    }
  }
  if (typeof d === 'string') return d;
  if (d !== undefined && d !== null) return JSON.stringify(d);
  return (rawText && rawText.slice(0, 600)) || r.statusText || 'Unknown error';
}

function stopLogStream() {
  if (_logAbort) {
    try { _logAbort.abort(); } catch (e) { /* ignore */ }
    _logAbort = null;
  }
  _logIsStreaming = false;
}

async function loadJenkinsLogsIntoModal(p) {
  const q = new URLSearchParams({ job_name: p.job_name, build_number: String(p.build_number) });
  if (p.instance_url) q.set('instance_url', p.instance_url);
  _setLogText(t('dash.log_fetching'));
  const r = await fetch(apiUrl('api/logs/jenkins?' + q.toString()));
  const rawText = await r.text();
  let data = {};
  try { data = JSON.parse(rawText); } catch { /* not JSON */ }
  _setLogText(r.ok ? (data.log || t('dash.log_empty')) : t('dash.log_error_prefix') + _formatLogFetchError(r, data, rawText));
}

async function loadGitlabLogsIntoModal(p) {
  const q = new URLSearchParams({ project_id: p.project_id, pipeline_id: String(p.pipeline_id) });
  if (p.instance_url) q.set('instance_url', p.instance_url);
  _setLogText(t('dash.log_fetching'));
  const r = await fetch(apiUrl('api/logs/gitlab?' + q.toString()));
  const rawText = await r.text();
  let data = {};
  try { data = JSON.parse(rawText); } catch { /* not JSON */ }
  _setLogText(r.ok ? (data.log || t('dash.log_empty')) : t('dash.log_error_prefix') + _formatLogFetchError(r, data, rawText));
}

async function loadDockerLogsIntoModal(container) {
  _setLogText(t('dash.log_fetching'));
  const name = String(container || '').trim();
  const r = await fetch(apiUrl('api/logs/docker?container=' + encodeURIComponent(name) + '&tail=4000'));
  const rawText = await r.text();
  let data = {};
  try { data = JSON.parse(rawText); } catch { /* not JSON */ }
  _setLogText(r.ok ? (data.log || t('dash.log_empty')) : t('dash.log_error_prefix') + _formatLogFetchError(r, data, rawText));
}

async function startDockerLogStream(container) {
  stopLogStream();
  const dec = new TextDecoder();
  _logAbort = new AbortController();
  _logIsStreaming = true;
  try {
    const res = await fetch(apiUrl('api/logs/docker/stream?container=' + encodeURIComponent(container)), { signal: _logAbort.signal });
    if (!res.ok) {
      const t = await res.text();
      let errData = {};
      try { errData = JSON.parse(t); } catch { /* */ }
      _logIsStreaming = false;
      _setLogText(_logRawText + '\n[stream error] ' + _formatLogFetchError(res, errData, t));
      return;
    }
    const reader = res.body.getReader();
    _logRawText += '\n--- live stream ---\n';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      _appendLogChunk(dec.decode(value, { stream: true }));
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      _logRawText += '\n[stream stopped] ' + e.message;
    }
  }
  _logIsStreaming = false;
  _renderLogLines();
}

async function openLogViewer(kind, params) {
  const ov = document.getElementById('log-modal');
  const title = document.getElementById('log-modal-title');
  if (!ov || !title) return;

  _logModalPrevFocus = document.activeElement;
  stopLogStream();
  _resetLogSearch();
  const followChk = document.getElementById('log-follow');
  if (followChk) {
    followChk.checked = false;
    followChk.onchange = null;
  }
  const followWrap = document.getElementById('log-follow-wrap');
  const btnRef = document.getElementById('log-btn-refresh');

  if (kind === 'docker') {
    title.textContent = 'Docker: ' + (params.container || '');
    if (followWrap) followWrap.classList.add('visible');
    const running = (params.status || '').toLowerCase() === 'up';
    if (followChk) {
      followChk.disabled = !running;
      followChk.title = running ? t('dash.log_follow_on') : t('dash.log_follow_off');
    }
    if (btnRef) btnRef.style.display = '';
    if (btnRef) btnRef.onclick = () => {
      stopLogStream();
      if (followChk) followChk.checked = false;
      loadDockerLogsIntoModal(params.container);
    };
    _setLogText(t('dash.log_fetching'));
    ov.classList.add('open');
    ov.setAttribute('aria-hidden', 'false');
    if (followChk) {
      followChk.onchange = () => {
        if (followChk.checked) startDockerLogStream(params.container);
        else stopLogStream();
      };
    }
    await loadDockerLogsIntoModal(params.container);
  } else {
    if (followWrap) followWrap.classList.remove('visible');
    if (btnRef) btnRef.style.display = '';
    if (kind === 'jenkins') {
      title.textContent = 'Jenkins: ' + params.job_name + ' #' + params.build_number;
      btnRef.onclick = () => loadJenkinsLogsIntoModal(params);
    } else {
      title.textContent = 'GitLab: ' + params.project_id + ' #' + params.pipeline_id;
      btnRef.onclick = () => loadGitlabLogsIntoModal(params);
    }
    _setLogText(t('dash.log_fetching'));
    ov.classList.add('open');
    ov.setAttribute('aria-hidden', 'false');
    if (kind === 'jenkins') await loadJenkinsLogsIntoModal(params);
    else await loadGitlabLogsIntoModal(params);
  }
  setTimeout(() => {
    document.querySelector('#log-modal .log-modal-header button')?.focus();
  }, 0);
}

function closeLogModal() {
  stopLogStream();
  _resetLogSearch();
  const lf = document.getElementById('log-follow');
  if (lf) lf.checked = false;
  const ov = document.getElementById('log-modal');
  if (ov) { ov.classList.remove('open'); ov.setAttribute('aria-hidden', 'true'); }
  const prev = _logModalPrevFocus;
  _logModalPrevFocus = null;
  if (prev && typeof prev.focus === 'function') {
    try { prev.focus(); } catch (_e) { /* ignore */ }
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('log-modal').classList.contains('open')) closeLogModal();
  if (e.key === 'Escape' && document.getElementById('ai-chat-panel').classList.contains('open')) toggleChat();
  // Ctrl+F inside log modal → focus custom search
  if ((e.ctrlKey || e.metaKey) && e.key === 'f' && document.getElementById('log-modal').classList.contains('open')) {
    e.preventDefault();
    const inp = document.getElementById('log-search-input');
    if (inp) { inp.focus(); inp.select(); }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AI Chat
// ─────────────────────────────────────────────────────────────────────────────
const CHAT_HISTORY_KEY = 'cimon-ai-chat-history';
const CHAT_MAX_MESSAGES = 100;
const _chatHistory = [];
let _chatStreaming = false;
let _chatModel = '';

function _persistChatHistory() {
  try {
    const trimmed = _chatHistory.slice(-CHAT_MAX_MESSAGES);
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(trimmed));
  } catch { /* ignore quota / private mode */ }
}

function _loadChatHistoryFromStorage() {
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    _chatHistory.length = 0;
    for (const m of arr) {
      if (!m || typeof m !== 'object') continue;
      const role = m.role;
      const content = m.content;
      if ((role === 'user' || role === 'assistant') && typeof content === 'string' && content.length) {
        _chatHistory.push({ role, content });
      }
    }
    if (_chatHistory.length > CHAT_MAX_MESSAGES) {
      _chatHistory.splice(0, _chatHistory.length - CHAT_MAX_MESSAGES);
    }
  } catch { /* ignore */ }
}

function _renderChatHistoryDom() {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  box.innerHTML = '';
  if (!_chatHistory.length) {
    const sys = document.createElement('div');
    sys.className = 'chat-msg system';
    sys.setAttribute('data-i18n', 'dash.chat_hello');
    sys.textContent = t('dash.chat_hello');
    box.appendChild(sys);
    return;
  }
  for (const m of _chatHistory) {
    if (m.role === 'assistant') {
      const div = document.createElement('div');
      div.className = 'chat-msg assistant';
      div.innerHTML = _miniMarkdown(m.content);
      box.appendChild(div);
    } else {
      const div = document.createElement('div');
      div.className = 'chat-msg user';
      div.textContent = m.content;
      box.appendChild(div);
    }
  }
  box.scrollTop = box.scrollHeight;
}

function _refreshChatHelloI18n() {
  const box = document.getElementById('chat-messages');
  if (!box || _chatHistory.length) return;
  const sys = box.querySelector('.chat-msg.system[data-i18n="dash.chat_hello"]');
  if (sys) sys.textContent = t('dash.chat_hello');
}

(async function initChat() {
  try {
    const r = await fetch(apiUrl('api/chat/status'));
    if (!r.ok) return;
    const d = await r.json();
    if (d.configured) {
      document.getElementById('ai-chat-fab').style.display = 'flex';
      _chatModel = d.model || '';
      const prov = d.provider || 'openai';
      let badge = _chatModel;
      if (prov !== 'openai') badge = prov + ' · ' + badge;
      if (d.proxy_enabled) badge += ' · proxy';
      document.getElementById('chat-model-badge').textContent = badge;
      if (prov === 'cursor' && d.cursor_agent_found === false) {
        const w = document.getElementById('chat-cursor-warn');
        if (w) w.style.display = 'block';
      }
      _loadChatHistoryFromStorage();
      _renderChatHistoryDom();
    }
  } catch {}
})();

function toggleChat() {
  const panel = document.getElementById('ai-chat-panel');
  const fab = document.getElementById('ai-chat-fab');
  const open = panel.classList.toggle('open');
  fab.classList.toggle('has-panel', open);
  document.getElementById('fab-icon').innerHTML = open ? '&times;' : '&#129302;';
  if (open) {
    document.getElementById('chat-input').focus();
    const msgs = document.getElementById('chat-messages');
    msgs.scrollTop = msgs.scrollHeight;
  }
}

function clearChat() {
  _chatHistory.length = 0;
  try { localStorage.removeItem(CHAT_HISTORY_KEY); } catch { /* ignore */ }
  const box = document.getElementById('chat-messages');
  if (!box) return;
  const sys = document.createElement('div');
  sys.className = 'chat-msg system';
  sys.textContent = t('dash.chat_cleared_ok');
  box.innerHTML = '';
  box.appendChild(sys);
}

function _gatherContext() {
  const parts = [];
  const status = document.getElementById('summary-bar');
  if (status) {
    const stats = status.querySelectorAll('.stat');
    const vals = [];
    stats.forEach(s => {
      const label = s.querySelector('.l');
      const num = s.querySelector('.n');
      if (label && num) vals.push(label.textContent.trim() + ': ' + num.textContent.trim());
    });
    if (vals.length) parts.push('Summary: ' + vals.join(', '));
  }

  const buildRows = document.querySelectorAll('#tbody-builds tr:not(.empty-row)');
  if (buildRows.length) {
    const rows = [];
    buildRows.forEach((tr, i) => {
      if (i >= 15) return;
      const cells = tr.querySelectorAll('td');
      const texts = [];
      cells.forEach(c => texts.push(c.textContent.trim().replace(/\s+/g, ' ')));
      rows.push(texts.join(' | '));
    });
    parts.push('Recent builds:\n' + rows.join('\n'));
  }

  const svcRows = document.querySelectorAll('#tbody-svcs tr:not(.empty-row)');
  if (svcRows.length) {
    const rows = [];
    svcRows.forEach((tr, i) => {
      if (i >= 20) return;
      const cells = tr.querySelectorAll('td');
      const texts = [];
      cells.forEach(c => texts.push(c.textContent.trim().replace(/\s+/g, ' ')));
      rows.push(texts.join(' | '));
    });
    parts.push('Services:\n' + rows.join('\n'));
  }

  const failRows = document.querySelectorAll('#tbody-failures tr:not(.empty-row)');
  if (failRows.length) {
    const rows = [];
    failRows.forEach((tr, i) => {
      if (i >= 15) return;
      const cells = tr.querySelectorAll('td');
      const texts = [];
      cells.forEach(c => texts.push(c.textContent.trim().replace(/\s+/g, ' ')));
      rows.push(texts.join(' | '));
    });
    parts.push('Top test failures:\n' + rows.join('\n'));
  }

  const logPre = document.getElementById('log-modal-pre');
  const logModal = document.getElementById('log-modal');
  if (logPre && logModal && logModal.classList.contains('open')) {
    const logTitle = document.getElementById('log-modal-title')?.textContent || 'Log';
    const logText = logPre.textContent.slice(-4000);
    parts.push('Currently open log (' + logTitle + '):\n' + logText);
  }

  return parts.join('\n\n');
}

function _miniMarkdown(text) {
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => '<pre><code>' + code.trim() + '</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');
  return html;
}

function _appendMsg(role, content) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg ' + role;
  if (role === 'assistant') {
    div.innerHTML = _miniMarkdown(content);
  } else if (role === 'error') {
    div.textContent = content;
  } else {
    div.textContent = content;
  }
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

async function sendChat() {
  if (_chatStreaming) return;
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  input.style.height = 'auto';
  _appendMsg('user', text);
  _chatHistory.push({ role: 'user', content: text });
  _persistChatHistory();

  const sendBtn = document.getElementById('chat-send-btn');
  sendBtn.disabled = true;
  _chatStreaming = true;

  const box = document.getElementById('chat-messages');
  const typing = document.createElement('div');
  typing.className = 'chat-typing';
  typing.textContent = 'Thinking';
  box.appendChild(typing);
  box.scrollTop = box.scrollHeight;

  const body = { messages: _chatHistory };
  if (document.getElementById('chat-ctx-toggle').checked) {
    body.context = _gatherContext();
  }

  let fullResponse = '';
  let assistantDiv = null;
  let streamError = '';

  try {
    const res = await fetch(apiUrl('api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.detail || res.statusText);
    }

    typing.remove();
    assistantDiv = _appendMsg('assistant', '');

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let aborted = false;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });

      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') {
          aborted = true;
          break;
        }
        try {
          const d = JSON.parse(payload);
          if (d.error) {
            streamError = d.error;
            _appendMsg('error', d.error);
            aborted = true;
            break;
          }
          if (d.t) {
            fullResponse += d.t;
            assistantDiv.innerHTML = _miniMarkdown(fullResponse);
            box.scrollTop = box.scrollHeight;
          }
        } catch (parseErr) {
          if (payload && payload !== '[DONE]') {
            console.warn('chat SSE parse', parseErr, payload.slice(0, 120));
          }
        }
      }
      if (aborted) break;
    }
    if (!fullResponse && !streamError && assistantDiv) {
      assistantDiv.innerHTML = '<span style="color:var(--muted)">Нет текста в ответе. Провайдер Cursor: в папке IDE обычно нет `agent` — нужен отдельный Cursor Agent CLI или путь в Настройках → AI. См. документацию CLI.</span>';
    }
  } catch (e) {
    typing.remove();
    _appendMsg('error', e.message || 'Connection failed');
  }

  if (fullResponse) {
    _chatHistory.push({ role: 'assistant', content: fullResponse });
    _persistChatHistory();
    // After streaming done, inject quick action buttons if AI suggested them
    if (assistantDiv) _injectQuickActions(assistantDiv, fullResponse);
  }

  _chatStreaming = false;
  sendBtn.disabled = false;
  document.getElementById('chat-input').focus();
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Quick Actions
// ─────────────────────────────────────────────────────────────────────────────
function _injectQuickActions(msgDiv, text) {
  // Detect container names mentioned with "restart", "stop", "start" context
  // Also look for jobs mentioned with "re-run", "trigger", "run"
  const actions = [];
  const textLower = text.toLowerCase();

  // Scan services panel for containers to suggest restart
  document.querySelectorAll('#tbody-svcs tr').forEach(tr => {
    const nameCell = tr.querySelector('td:first-child strong');
    if (!nameCell) return;
    const name = nameCell.textContent.trim();
    const nameLower = name.toLowerCase();
    if (textLower.includes(nameLower)) {
      const statusCell = tr.querySelector('td:nth-child(3)');
      const status = statusCell ? statusCell.textContent.trim().toLowerCase() : '';
      if (status === 'down' || textLower.includes('restart') || textLower.includes('stop')) {
        actions.push({ label: `↻ Restart ${name}`, action: () => { const btn = document.createElement('button'); dockerContainerAction(btn, name, 'restart'); } });
      }
      if (status === 'down') {
        actions.push({ label: `▶ Start ${name}`, action: () => { const btn = document.createElement('button'); dockerContainerAction(btn, name, 'start'); } });
      }
    }
  });

  // Scan builds panel for Jenkins jobs
  document.querySelectorAll('#tbody-builds tr').forEach(tr => {
    const srcCell = tr.querySelector('td:nth-child(2)');
    const jobCell = tr.querySelector('td:nth-child(3)');
    if (!srcCell || !jobCell) return;
    const src = srcCell.textContent.trim().toLowerCase();
    const job = jobCell.textContent.trim().replace(/FLAKY$/, '').trim();
    const jobLower = job.toLowerCase();
    if (textLower.includes(jobLower) && (textLower.includes('re-run') || textLower.includes('rerun') || textLower.includes('trigger') || textLower.includes('retry'))) {
      if (src === 'jenkins' && !actions.some(a => a.label.includes(job))) {
        actions.push({ label: `▶ Re-run ${job}`, action: () => { const btn = document.createElement('button'); triggerJenkinsBuild(btn, job); } });
      }
    }
  });

  // Scroll to services
  if (textLower.includes('check service') || textLower.includes('services panel') || textLower.includes('docker panel')) {
    actions.push({ label: '⇩ Scroll to Services', action: () => goToInTab('services', 'panel-svcs') });
  }

  // Collect
  if (textLower.includes('collect') || textLower.includes('refresh data') || textLower.includes('update data')) {
    actions.push({ label: '↻ Collect Now', action: () => document.getElementById('btn-collect')?.click() });
  }

  if (!actions.length) return;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.5rem;';
  actions.slice(0, 5).forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.style.cssText = 'font-size:.72rem;padding:.2rem .55rem;';
    btn.textContent = a.label;
    btn.addEventListener('click', () => {
      a.action();
      showToast('Action triggered: ' + a.label, 'ok');
    });
    wrap.appendChild(btn);
  });
  msgDiv.appendChild(wrap);
}

document.getElementById('chat-input').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});
