// Service uptime bars + build duration sparklines (snapshot + API enrich).
// Load after dashboard.flaky.js, before the rest of dashboard.js.

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
