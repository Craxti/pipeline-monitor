// Collect log stream, tests-parse note, auto-refresh during collect: dashboard.collect-panel.js
// Load after dashboard.services.js, before dashboard.status-map.js.

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
