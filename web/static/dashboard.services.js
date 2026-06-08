// Services panel (list + Docker actions): dashboard.services.js
// Load after dashboard.tests.js, before the rest of dashboard.js.

// ─────────────────────────────────────────────────────────────────────────────
// SERVICES
// ─────────────────────────────────────────────────────────────────────────────
function resetServices(soft=false, force=false) {
  const s = _state.svcs; s.page=1; s.done=false;
  if (force) {
    // A docker action may finish while an older services request is still in flight.
    // Cancel stale request and allow immediate fresh poll.
    try { abortFetchKey('services'); } catch { /* ignore */ }
    s.loading = false;
  }
  const tb = document.getElementById('tbody-svcs');
  if (!soft) tb.innerHTML = tableLoadingRowHtml(8);
  loadServices();
}
function clearSvcFilters() {
  document.getElementById('f-svstatus').value = '';
  try { localStorage.removeItem('cimon-svc-problems'); } catch {}
  try { _persistFiltersFromForm(); } catch { _syncURLAndFilterSummary(); }
  resetServices();
}

function setSvcStatusFilter(value) {
  const sel = document.getElementById('f-svstatus');
  if (sel) sel.value = value || '';
  try { _persistFiltersFromForm(); } catch { _syncURLAndFilterSummary(); }
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
  const tbody = document.getElementById('tbody-svcs');
  if (guardPanelLoadDuringCollect('svcs', tbody, s)) return;
  panelScrollContinuePage(s, tbody);
  s.loading = true;
  try {
    const rawStatus = document.getElementById('f-svstatus')?.value || '';
    const status = rawStatus;
    const incrFirstPage = typeof isCollectIncrFirstPage === 'function' && isCollectIncrFirstPage(s);
    const perPage = s.per_page;

    while (!s.done) {
      const url = apiUrl(`api/services?page=${s.page}&per_page=${perPage}&status=${encodeURIComponent(status)}`);
      const res = await fetchKeyed('services', url).catch(() => null);
      if (res === FETCH_ABORTED) return;
      if (!res || !res.ok) {
        if (keepTableOnTransientApiError(tbody, res, s, 'svcs')) return;
        if (res && res.status === 404) {
          tbody.innerHTML = `<tr class="empty-row"><td colspan="8">${esc(t('dash.table_no_test_data'))}${emptyStateActionsHtml()}</td></tr>`;
        } else {
          const detail = await fetchApiErrorDetail(res);
          srAnnounce(t('dash.table_api_err') + (detail ? ': ' + detail : ''), 'assertive');
          const extra = detail ? ` — ${esc(detail)}` : '';
          tbody.innerHTML = `<tr class="empty-row"><td colspan="8">${esc(t('dash.table_api_err'))}${extra}<br/><span class="err-hint">${esc(t('err.hint_retry'))}</span> <button type="button" class="btn btn-ghost" onclick="refreshAll()">${esc(t('common.retry'))}</button></td></tr>`;
        }
        s.done = true;
        updateFilterSummary();
        return;
      }

      const data = await res.json();
      s.total = data.total;
      document.getElementById('svcs-count').textContent = data.total;

      const rows = data.items;
      if (s.page === 1 && !rows.length) {
        if (keepTableOnTransientEmpty(tbody, rows, s, 'svcs')) return;
        tbody.innerHTML = `<tr class="empty-row"><td colspan="8"><div>${esc(t('dash.table_no_svcs'))}</div><div class="empty-hint">${t('dash.empty_svcs_hint')}</div>${emptyStateActionsHtml()}</td></tr>`;
        s.done = true;
        updateFilterSummary();
        return;
      }

      if (s.page === 1) {
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
      }

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
      const keyArg = JSON.stringify(`${host}::${sv.name}`);
      logCell = `<button type="button" class="act-btn log-btn" onclick='openLogViewer("docker",${JSON.stringify(p)})' title="${_svgTitleAttr(t('dash.log_title'))}">&#128466;</button>
        <button type="button" class="act-btn lintel-btn" onclick='openLogIntelTab(${keyArg})' title="${_svgTitleAttr(t('dash.log_intel_open'))}"></button>`;
      if (up) {
        actionBtn = `<div class="act-group svc-docker-actions">
          <button type="button" class="act-btn docker-stop" title="Остановить" aria-label="Остановить" data-dash-action="dockerContainerAction" data-dash-args='[${nm},"stop",${hostArg}]'>&#9632;</button>
          <button type="button" class="act-btn docker-restart" title="Перезапустить" aria-label="Перезапустить" data-dash-action="dockerContainerAction" data-dash-args='[${nm},"restart",${hostArg}]'>&#8635;</button>
        </div>`;
      } else {
        actionBtn = `<div class="act-group svc-docker-actions">
          <button type="button" class="act-btn docker-start" title="Запустить" aria-label="Запустить" data-dash-action="dockerContainerAction" data-dash-args='[${nm},"start",${hostArg}]'>&#9654;</button>
          <button type="button" class="act-btn docker-restart" title="Перезапустить" aria-label="Перезапустить" data-dash-action="dockerContainerAction" data-dash-args='[${nm},"restart",${hostArg}]'>&#8635;</button>
        </div>`;
      }
    }
    const uptimeHtml = _svcUptimeBar(sv.name);
    const dt = _svgTitleAttr(sv.detail || '');
    const ch = lastCh[String(sv.name || '')];
    const chAgo = ch && ch.ts ? _fmtAgo(ch.ts) : '';
    const chTxt = chAgo ? ` · ${chAgo}` : '';
    const srcInst = String(sv.source_instance || '').trim();
    const nameTitle = srcInst ? `${sv.name} (${srcInst})` : sv.name;
    return `<tr data-svc-name="${encodeURIComponent(String(sv.name || ''))}" data-svc-host="${encodeURIComponent(String(sv.source_instance || ''))}" data-svc-kind="${encodeURIComponent(String(sv.kind || ''))}">
    <td><strong title="${_svgTitleAttr(nameTitle)}">${esc(sv.name)}</strong>${srcInst ? `<div style="color:var(--muted);font-size:.72rem">${esc(srcInst)}</div>` : ''}</td>
    <td>${esc(sv.kind)}</td>
    <td>${badge(sv.status)}</td>
    <td class="col-compact-hide" style="color:var(--muted);font-size:.8rem" title="${dt}">${esc(sv.detail)}</td>
    <td style="white-space:nowrap;font-size:.78rem" title="${_svgTitleAttr(chAgo ? ('Last change: ' + chAgo) : '')}">${fmt(sv.checked_at)}<span style="color:var(--muted)">${esc(chTxt)}</span></td>
    <td class="col-compact-hide">${uptimeHtml}</td>
    <td>${logCell}</td>
    <td style="text-align:right">${actionBtn}</td>
  </tr>`;
      }).join('');

      if (s.page === 1) {
        swapTableContentSmooth(tbody, () => { tbody.innerHTML = html; });
      } else {
        tbody.insertAdjacentHTML('beforeend', html);
      }

      if (incrFirstPage) {
        s.done = !data.has_more;
        break;
      }

      if (!data.has_more) {
        s.done = true;
        break;
      }
      s.page++;
      if (typeof yieldToBrowser === 'function') await yieldToBrowser(24);
    }

    if (s.done && tbodyHasDataRows(tbody)) {
      try { cacheStaleTableHtml('svcs', tbody); } catch { /* ignore */ }
    }
    _applyGlobalSearch();
    updateFilterSummary();
  } finally {
    s.loading = false;
    if (!s.done) scheduleTablePageChain(s, loadServices, tbody);
  }
}
