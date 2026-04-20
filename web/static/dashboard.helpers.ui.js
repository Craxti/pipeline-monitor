// Split from dashboard.helpers.js — preserve script order in web/templates/index.html
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
  _topCollectActive = collecting;
  const lastErr = c.last_error ? String(c.last_error) : '';
  if (collectTxt) {
    collectTxt.textContent = collecting
      ? t('top.collect_running')
      : (lastErr ? t('top.collect_error') : t('top.collect_ok'));
  }
  if (collectDot) collectDot.className = 'topdot ' + (collecting ? 'warn' : (lastErr ? 'err' : 'ok'));

  const ageSec = (s && s.age_seconds != null) ? Number(s.age_seconds) : null;
  const stale = !!(s && s.stale);
  const thRaw = (s && s.stale_threshold_seconds != null) ? Number(s.stale_threshold_seconds) : null;
  _topStaleThresholdSec = (thRaw != null && !isNaN(thRaw) && thRaw > 0) ? thRaw : null;

  if (ageSec == null || isNaN(ageSec)) {
    _topAgeBaseSec = null;
    _topAgeBaseTs = 0;
    _topAgeStale = false;
    _topStaleThresholdSec = null;
    if (ageTxt) ageTxt.textContent = t('top.age_empty');
    if (ageDot) ageDot.className = 'topdot';
    try { _maybeNotifySnapshotStale(false); } catch (e) { /* ignore */ }
  } else {
    _topAgeBaseSec = Math.max(0, Math.round(ageSec));
    _topAgeBaseTs = Date.now();
    _topAgeStale = stale;
    if (ageTxt) ageTxt.textContent = tf('top.age_fmt', { s: _topAgeBaseSec });
    const extra0 = 0;
    const val0 = _topAgeBaseSec + extra0;
    const clientOver0 = _topStaleThresholdSec != null && val0 > _topStaleThresholdSec;
    if (ageDot) ageDot.className = 'topdot ' + (stale || clientOver0 ? 'warn' : 'ok');
    if (!_topAgeTimer) {
      _topAgeTimer = setInterval(() => {
        if (_topAgeBaseSec == null || !_topAgeBaseTs) return;
        const extra = Math.max(0, Math.floor((Date.now() - _topAgeBaseTs) / 1000));
        const val = _topAgeBaseSec + extra;
        const tEl = document.getElementById('top-age-txt');
        if (tEl) tEl.textContent = tf('top.age_fmt', { s: val });
        const clientOver = _topStaleThresholdSec != null && val > _topStaleThresholdSec;
        const dEl = document.getElementById('top-age-dot');
        if (dEl) dEl.className = 'topdot ' + (_topAgeStale || clientOver ? 'warn' : 'ok');
        try { _maybeNotifySnapshotStale(!!_topAgeStale || clientOver); } catch (e) { /* ignore */ }
      }, 1000);
    }
    try { _maybeNotifySnapshotStale(!!stale || !!clientOver0); } catch (e) { /* ignore */ }
  }

  if (redTxt) {
    redTxt.textContent = tf('top.red_fmt', { b: nFail || 0, t: nTFail || 0, s: nDown || 0 });
  }

  const ih = (summaryObj && Array.isArray(summaryObj.instance_health)) ? summaryObj.instance_health
    : (metaObj && Array.isArray(metaObj.instance_health)) ? metaObj.instance_health
    : [];
  const down = ih.filter((x) => x && x.ok === false).length;
  const total = ih.length;
  if (srcTxt) {
    srcTxt.textContent = total
      ? tf('top.sources_fmt', { ok: total - down, total })
      : t('top.sources_empty');
  }
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

function _openAiChatAndSendPrompt(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return;

  const panel = document.getElementById('ai-chat-panel');
  const fab = document.getElementById('ai-chat-fab');
  const icon = document.getElementById('fab-icon');
  if (!panel) return;

  const tryOnce = () => {
    // Prefer official open/close logic if available.
    try {
      if (typeof window.toggleChat === 'function' && !panel.classList.contains('open')) {
        window.toggleChat();
      }
    } catch { /* ignore */ }

    // Ensure panel is open even if toggleChat is unavailable or FAB hidden.
    try {
      panel.classList.add('open');
      panel.style.display = 'flex';
      if (fab) {
        fab.classList.add('has-panel');
        // If chat is not configured, FAB stays hidden by initChat(). Still show it so user can close.
        if (fab.style && fab.style.display === 'none') fab.style.display = 'flex';
      }
      if (icon) icon.innerHTML = '&times;';
    } catch { /* ignore */ }

    const input = document.getElementById('chat-input');
    if (!input) return false;

    try {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } catch { /* ignore */ }

    const sendFn = (window && window.sendChat) ? window.sendChat : (typeof sendChat === 'function' ? sendChat : null);
    if (typeof sendFn === 'function') {
      try { sendFn(); } catch { /* ignore */ }
      return true;
    }

    try { input.focus(); } catch { /* ignore */ }
    return true;
  };

  // Retry a few times to avoid race with tab switch, deferred script load, or slow initChat().
  if (tryOnce()) return;
  setTimeout(tryOnce, 120);
  setTimeout(tryOnce, 350);
  setTimeout(tryOnce, 900);
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

  // Open AI assistant and seed a troubleshooting prompt.
  try {
    // Give the tab switch a moment to settle.
    setTimeout(() => {
      const fallback = 'Разобрать упавшие тесты: дай план диагностики, выдели топ причин и что проверить в первую очередь.';
      const p = (typeof window.chatPrompt === 'function')
        ? window.chatPrompt('runbook_focus_tests', fallback)
        : fallback;
      _openAiChatAndSendPrompt(p);
    }, 60);
  } catch { /* ignore */ }
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
  const fFsource = byId('f-fsource');
  if (fFsource) {
    fFsource.addEventListener('change', () => {
      resetFailures();
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
  const trTopSrc = byId('trends-top-test-source');
  if (trTopSrc) trTopSrc.addEventListener('change', () => { onTrendsTopTestSourceChange(trTopSrc); });
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
