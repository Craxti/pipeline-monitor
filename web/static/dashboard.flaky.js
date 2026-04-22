// Incidents panel (flaky list intentionally disabled).
// Load after dashboard.timeline.js, before dashboard.uptime-sparklines.js.

let _flakyPanelVisible = true;
function toggleFlakyPanel() {
  _flakyPanelVisible = !_flakyPanelVisible;
  const body = document.getElementById('flaky-body');
  const btn = document.getElementById('expand-flaky-panel');
  if (body) body.style.display = _flakyPanelVisible ? '' : 'none';
  if (btn) btn.textContent = _flakyPanelVisible ? t('dash.map_hide') : t('dash.map_show');
}

function analyzeCorrelation(builds) {
  const items = (builds || [])
    .filter(b => b && (b.status === 'failure' || b.status === 'unstable') && b.started_at)
    .map(b => ({ ...b, _ts: new Date(b.started_at).getTime() }))
    .filter(b => !isNaN(b._ts))
    .sort((a, b) => b._ts - a._ts);
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
  const flakyList = document.getElementById('flaky-list');
  if (flakyList) flakyList.innerHTML = '';
  const incList = document.getElementById('incident-list');
  const panel = document.getElementById('panel-flaky');
  const countEl = document.getElementById('flaky-count');
  if (!incList || !panel) return;
  const incidents = analyzeCorrelation(builds);
  if (!incidents.length) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';
  if (countEl) countEl.textContent = String(incidents.length);
  const MAX_INC = 10;
  const shown = incidents.slice(0, MAX_INC);
  const more = Math.max(0, incidents.length - shown.length);
  const hdr = `<div style="padding:.3rem 1rem .1rem;font-size:.8rem;font-weight:700;color:var(--fail);display:flex;align-items:center;gap:.35rem;flex-wrap:wrap">&#9888; <span>${t('incident.correlated_title')}</span><button type="button" class="glossary-hint" title="${_svgTitleAttr(t('glossary.incidents'))}">?</button></div>`;
  incList.innerHTML = hdr + shown.map(inc => {
    const incJson = JSON.stringify(inc).replace(/</g, '\\u003c').replace(/&/g, '\\u0026');
    const hint = _svgTitleAttr(t('dash.action_view') + (inc.jobs && inc.jobs[0] ? ' — ' + inc.jobs[0] : ''));
    return `
    <div class="incident-card incident-card-clickable" role="button" tabindex="0" title="${hint}" onclick='applyIncidentFilter(${incJson})' onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();applyIncidentFilter(${incJson});}">
      <div class="incident-title">&#128683; ${inc.count} ${esc(t('incident.within_10'))} — ${_tlAgo(inc.start)}</div>
      <div class="incident-jobs">${esc(t('incident.jobs_lbl'))}: ${inc.jobs.map(j => `<strong>${_escHtml(j)}</strong>`).join(', ')}</div>
      <div class="incident-jobs" style="margin-top:.15rem">${esc(t('incident.sources_lbl'))}: ${inc.sources.map(s => _escHtml(s)).join(', ')}</div>
    </div>`;
  }).join('') + (more ? `<div style="padding:.35rem 1rem;color:var(--muted);font-size:.78rem">+${more} more</div>` : '');
}
