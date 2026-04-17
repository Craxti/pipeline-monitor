// Core dashboard logic; helpers/debounce live in dashboard.helpers.js (load before this file).
// Fetch helpers: dashboard.fetch.js (load after helpers, before this file).
// Panel state / observers / expand: dashboard.panel-state.js (after fetch, before this file).
// Build log cell HTML + Jenkins/GitLab URL helpers: dashboard.build-log-cells.js (after panel-state, before this file).
// BUILDS table: dashboard.builds.js (after build-log-cells).
// Top failures: dashboard.failures.js (after builds).

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
    const stack = document.createElement('div');
    stack.className = 'cell-stack';
    if (row.source) {
      stack.appendChild(mkSrcBadge(row.source));
    }
    const nameSpan = document.createElement('span');
    nameSpan.className = 'cell-main';
    nameSpan.textContent = String(row.test_name || '');
    stack.appendChild(nameSpan);
    td0.appendChild(stack);

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
  const jobsInPanel = new Set(flaky.map(f => f.job));
  for (const inc of incidents) {
    for (const j of inc.jobs || []) {
      if (j) jobsInPanel.add(j);
    }
  }
  const panelJobCount = jobsInPanel.size;

  if (statEl) statEl.textContent = panelJobCount;

  if (!flaky.length && !incidents.length) {
    if (panel) panel.style.display = 'none';
    return;
  }
  if (panel) panel.style.display = '';
  if (countEl) countEl.textContent = panelJobCount;

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

// Panel state / _state / observers: dashboard.panel-state.js (after fetch, before this file).
// Build log cells: dashboard.build-log-cells.js (after panel-state, before this file).
// BUILDS + top failures tables: dashboard.builds.js, dashboard.failures.js (after build-log-cells).
// LIVE/SSE polling: dashboard.live.js (load before dashboard.init.js).
// Filter URL sync + updateFilterSummary: dashboard.filters.js (after actions, before sources).
// Source/instance dropdowns: dashboard.sources.js (after filters).
// Theme / compact / CSV export: dashboard.theme-export.js (after sources).
