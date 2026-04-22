// Services panel (list + Docker actions): dashboard.services.js
// Load after dashboard.tests.js, before the rest of dashboard.js.

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
  try { _persistFiltersFromForm(); } catch { _syncURLAndFilterSummary(); }
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

  const rawStatus = document.getElementById('f-svstatus')?.value || '';
  const status = _svcProblemsOnly ? 'problems' : rawStatus;
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
      const host = String(sv.source_instance || '');
      const hostArg = JSON.stringify(host);
      const p = { container: sv.name, status: sv.status, docker_host: host };
      logCell = `<button type="button" class="act-btn log-btn" onclick='openLogViewer("docker",${JSON.stringify(p)})' title="${_svgTitleAttr(t('dash.log_title'))}">&#128466;</button>`;
      if (up) {
        actionBtn = `<div class="act-group">
          <button type="button" class="act-btn docker-stop" title="Остановить" onclick="dockerContainerAction(this,${nm},'stop',${hostArg})">&#9632; Stop</button>
          <button type="button" class="act-btn docker-btn" title="Перезапустить" onclick="dockerContainerAction(this,${nm},'restart',${hostArg})">&#8635; Restart</button>
        </div>`;
      } else {
        actionBtn = `<div class="act-group">
          <button type="button" class="act-btn docker-start" title="Запустить" onclick="dockerContainerAction(this,${nm},'start',${hostArg})">&#9654; Start</button>
          <button type="button" class="act-btn docker-btn" title="Перезапустить" onclick="dockerContainerAction(this,${nm},'restart',${hostArg})">&#8635; Restart</button>
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
