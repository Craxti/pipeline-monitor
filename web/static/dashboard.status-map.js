// Status map (overview grid + tooltips): dashboard.status-map.js
// Load after dashboard.collect-panel.js, before the rest of dashboard.js.

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

