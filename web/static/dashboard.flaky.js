// Flaky detection + failure correlation panel.
// Load after dashboard.timeline.js, before dashboard.uptime-sparklines.js.

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
