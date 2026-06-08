// Service-analysis incidents (graph-backed RCA) — dashboard.service-incidents.js

let _serviceIncidentsCache = [];
let _serviceIncidentsPollTs = 0;

async function loadServiceIncidentsForCenter(force) {
  const wrap = document.getElementById('ic-cards');
  if (!wrap) return;
  const now = Date.now();
  if (!force && now - _serviceIncidentsPollTs < 4000 && _serviceIncidentsCache.length) {
    renderServiceIncidentCards(_serviceIncidentsCache);
    return;
  }
  _serviceIncidentsPollTs = now;
  const res = await fetch(apiUrl('api/service-incidents?limit=80')).catch(() => null);
  if (!res || !res.ok) {
    wrap.innerHTML = `<div class="empty-card">${esc(typeof t === 'function' ? t('dash.table_api_err') : 'API error')}</div>`;
    wrap.style.display = 'block';
    return;
  }
  const data = await res.json();
  _serviceIncidentsCache = Array.isArray(data.items) ? data.items : [];
  renderServiceIncidentCards(_serviceIncidentsCache);
  updateIncidentCenterFromServiceIncidents(_serviceIncidentsCache);
}

function renderServiceIncidentCards(items) {
  const wrap = document.getElementById('ic-cards');
  const feedHead = document.getElementById('ic-feed-head');
  const feedCount = document.getElementById('ic-feed-count');
  const tl = document.getElementById('ic-timeline');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (tl) { tl.innerHTML = ''; tl.style.display = 'none'; }

  const rows = (items || []).slice().sort((a, b) => {
    const ao = String(a.status || '') === 'open' ? 0 : 1;
    const bo = String(b.status || '') === 'open' ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return String(b.opened_at || '').localeCompare(String(a.opened_at || ''));
  });

  if (!rows.length) {
    wrap.style.display = 'none';
    if (feedHead) feedHead.style.display = 'none';
    if (feedCount) feedCount.textContent = '0';
    return;
  }

  const openN = rows.filter((r) => String(r.status || '') === 'open').length;
  wrap.innerHTML = rows.map((inc) => _serviceIncidentCardHtml(inc)).join('');
  wrap.querySelectorAll('[data-svc-inc]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-svc-inc');
      const row = rows.find((r) => String(r.id) === String(id));
      if (row) openServiceIncident(row);
    });
  });
  wrap.style.display = 'block';
  if (feedHead) feedHead.style.display = 'flex';
  if (feedCount) feedCount.textContent = String(openN || rows.length);

  const aff = document.getElementById('ic-affected');
  const meta = document.getElementById('ic-meta');
  if (aff) aff.style.display = 'none';
  if (meta) meta.style.display = rows.length ? 'none' : '';
}

function _serviceIncidentCardHtml(inc) {
  const st = String(inc.status || 'open');
  const resolved = st === 'resolved';
  const cls = resolved ? 'ic-resolved' : (String(inc.severity || '') === 'critical' ? 'ic-fail' : 'ic-warn');
  const badgeTxt = resolved
    ? (typeof t === 'function' ? t('icenter.inc_resolved') : 'Resolved')
    : (typeof t === 'function' ? t('icenter.inc_open') : 'Open');
  const kind = String(inc.service_kind || '');
  const name = String(inc.service_name || '—');
  const host = String(inc.source_instance || '');
  const when = inc.opened_at ? fmt(inc.opened_at) : '—';
  const roots = Array.isArray(inc.root_nodes) ? inc.root_nodes.length : 0;
  const graph = inc.graph && inc.graph.correlation ? inc.graph.correlation : null;
  const edges = graph && Array.isArray(graph.edges) ? graph.edges.length : 0;
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes.length : 0;
  return `<article class="incident-card incident-card-clickable svc-inc-card ${cls}" role="button" tabindex="0" data-svc-inc="${esc(String(inc.id || ''))}">
    <div class="incident-title">${esc(String(inc.title || name))} <span class="svc-inc-badge ${resolved ? 'ok' : 'bad'}">${esc(badgeTxt)}</span></div>
    <div class="incident-jobs">${esc(kind)} · <strong>${esc(name)}</strong>${host ? ` · ${esc(host)}` : ''}</div>
    <div class="incident-jobs muted" style="margin-top:.2rem;font-size:.78rem">${esc(String(inc.detail || '')).slice(0, 180)}</div>
    <div class="incident-jobs muted" style="margin-top:.25rem;font-size:.72rem">${esc(when)} · graph ${nodes}↔${edges}${roots ? ` · ${roots} root` : ''}</div>
  </article>`;
}

function openServiceIncident(inc) {
  if (!inc) return;
  const key = String(inc.service_key || '');
  if (key && typeof openLogIntelDetail === 'function') {
    setDashboardTab('log-intel');
    openLogIntelDetail(key);
    return;
  }
  setDashboardTab('incidents');
}

function renderIncidentCards(_snap) {
  loadServiceIncidentsForCenter(true);
}

function updateIncidentCenterFromServiceIncidents(items) {
  const rows = items || _serviceIncidentsCache || [];
  const openRows = rows.filter((r) => String(r.status || '') === 'open');
  const sevEl = document.getElementById('ic-sev');
  if (sevEl) {
    if (!openRows.length) {
      sevEl.className = 'ic-sev ok';
      sevEl.textContent = typeof t === 'function' ? t('icenter.severity_ok') : 'OK';
    } else {
      const crit = openRows.some((r) => String(r.severity || '') === 'critical');
      sevEl.className = 'ic-sev ' + (crit ? 'critical' : 'warn');
      sevEl.textContent = typeof t === 'function' ? t(crit ? 'icenter.severity_critical' : 'icenter.severity_warn') : (crit ? 'Critical' : 'Warning');
    }
  }
  const icKpiBuilds = document.getElementById('ic-kpi-builds');
  const icKpiTests = document.getElementById('ic-kpi-tests');
  const icKpiSvcs = document.getElementById('ic-kpi-svcs');
  if (icKpiBuilds) {
    icKpiBuilds.textContent = String(openRows.length);
    icKpiBuilds.className = 'ic-kpi-val ' + (openRows.length ? 'c-fail' : 'c-ok');
  }
  if (icKpiTests) {
    const resolved = rows.filter((r) => String(r.status || '') === 'resolved').length;
    icKpiTests.textContent = String(resolved);
    icKpiTests.className = 'ic-kpi-val ' + (resolved ? 'c-ok' : 'c-info');
  }
  if (icKpiSvcs) {
    icKpiSvcs.textContent = String(rows.length);
    icKpiSvcs.className = 'ic-kpi-val c-info';
  }
  const aff = document.getElementById('ic-affected');
  if (aff && openRows.length) {
    aff.innerHTML = openRows.slice(0, 6).map((r) =>
      `<div>• ${esc(String(r.service_kind || ''))} <strong>${esc(String(r.service_name || ''))}</strong> — ${esc(String(r.title || ''))}</div>`
    ).join('');
    aff.style.display = '';
  }
}

async function refreshServiceIncidentsPanel() {
  await loadServiceIncidentsForCenter(true);
}
