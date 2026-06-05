// loadSummary — snapshot fetch, stat cards, incident hook, map/spark/timeline/flaky refresh.
// Load after dashboard.uptime-sparklines.js, before dashboard.collect-bar.js.

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
    const wu = metaObj.web_ui;
    if (wu && typeof wu.live_dashboard_poll_seconds !== 'undefined') {
      const next = _clampLiveDashboardPollSec(wu.live_dashboard_poll_seconds);
      if (next !== _liveDashboardPollSec) {
        _liveDashboardPollSec = next;
        try { restartLiveDashboardTimers(); } catch { /* live.js not loaded yet */ }
      }
    }
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

  const nOk = builds.filter((b) => b.status === 'success').length;
  const nFail = builds.filter((b) => b.status === 'failure').length;
  const nTFail = tests.filter((t) => ['failed', 'error'].includes(t.status)).length;
  const nTPass = tests.filter((t) => t.status === 'passed').length;
  const nTestsTotal = tests.length;
  const nDown = svcs.filter((s) => s.status === 'down').length;
  const passRate = nTestsTotal ? Math.round((nTPass / nTestsTotal) * 1000) / 10 : null;

  document.getElementById('s-builds').textContent = builds.length;
  document.getElementById('s-fail').textContent = nFail;
  document.getElementById('s-run').textContent = builds.filter((b) => b.status === 'running').length;
  document.getElementById('s-tfail').textContent = nTFail;

  const heroOk = document.getElementById('hero-builds-ok');
  const heroFail = document.getElementById('hero-builds-fail');
  if (heroOk) heroOk.textContent = nOk;
  if (heroFail) heroFail.textContent = nFail;

  const heroTestsTotal = document.getElementById('hero-tests-total');
  const heroTestsFail = document.getElementById('hero-tests-fail');
  const heroTestsRate = document.getElementById('hero-tests-rate');
  if (heroTestsTotal) heroTestsTotal.textContent = nTestsTotal;
  if (heroTestsFail) heroTestsFail.textContent = nTFail;
  if (heroTestsRate) heroTestsRate.textContent = passRate != null ? `${passRate}%` : '—';

  const heroSvcsTotal = document.getElementById('hero-svcs-total');
  const heroSvcsDown = document.getElementById('hero-svcs-down');
  const heroSvcsList = document.getElementById('hero-svcs-list');
  if (heroSvcsTotal) heroSvcsTotal.textContent = svcs.length;
  if (heroSvcsDown) heroSvcsDown.textContent = nDown;
  if (heroSvcsList) {
    const downNames = svcs.filter((s) => s.status === 'down').slice(0, 3).map((s) => s.name);
    heroSvcsList.textContent = downNames.length ? downNames.join(', ') : '';
  }

  updateSituationStrip(nFail, nTFail, nDown);
  try { updateTopStatusBar(metaObj, summaryObj, nFail, nTFail, nDown); } catch (e) { /* ignore */ }

  renderOverviewPreview(builds, svcs);

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

  // Sparklines — snapshot first (instant), SQLite batch enriches after idle
  _buildSparkData(builds);
  scheduleSparklineFetch([...new Set(builds.map(b => b.job_name))]);
  _renderFavPanel();
  updateExecHealthLine();
  _finalizeStatTrends();
}

function _buildStatusLabel(st) {
  const K = { success: 'ok', failure: 'fail', running: 'run', unstable: 'warn', aborted: 'warn', unknown: 'warn' };
  return K[st] || 'warn';
}

function _buildStatusText(st) {
  const K = {
    success: 'Build Success',
    failure: 'Build Failed',
    running: 'Running',
    unstable: 'Unstable',
    aborted: 'Aborted',
    unknown: 'Unknown',
  };
  return K[st] || st;
}

function _overviewSourceKind(source) {
  const s = String(source || '').trim().toLowerCase();
  if (s === 'jenkins' || s.startsWith('jenkins_')) return 'jenkins';
  if (s === 'gitlab' || s.startsWith('gitlab_')) return 'gitlab';
  return '';
}

function _overviewLatestJobs(builds, kind) {
  const byKey = {};
  (Array.isArray(builds) ? builds : []).forEach((b) => {
    if (_overviewSourceKind(b.source) !== kind) return;
    const key = `${b.instance || ''}||${b.job_name || ''}`;
    const prev = byKey[key];
    if (!prev || String(b.started_at || '') > String(prev.started_at || '')) byKey[key] = b;
  });
  const ord = { failure: 0, running: 1, unstable: 2, success: 3, aborted: 4, unknown: 5 };
  return Object.values(byKey).sort((a, b) => {
    const sa = normalizeBuildStatus(a.status);
    const sb = normalizeBuildStatus(b.status);
    return (ord[sa] ?? 5) - (ord[sb] ?? 5)
      || String(a.job_name || '').localeCompare(String(b.job_name || ''));
  }).slice(0, 8);
}

function _overviewJobLabel(b) {
  const job = b.job_name || '—';
  if (b.instance) return `${b.instance} / ${job}`;
  return job;
}

function _overviewCiHealthRow(b) {
  const st = normalizeBuildStatus(b.status);
  const cls = _buildStatusLabel(st);
  const label = _buildStatusText(st);
  const src = _overviewSourceKind(b.source) || String(b.source || '');
  const inst = b.instance || '';
  const job = b.job_name || '';
  const age = b.started_at && typeof ago === 'function' ? esc(ago(b.started_at)) : '—';
  const args = JSON.stringify([src, '', job, inst]);
  return `<tr class="overview-row-click" data-dash-action="filterBuilds" data-dash-args='${args}'>
    <td>${esc(_overviewJobLabel(b))}</td>
    <td><span class="ov-status ${cls}">${esc(label)}</span></td>
    <td>${age}</td>
  </tr>`;
}

function renderOverviewPreview(builds, services) {
  const recentEl = document.getElementById('overview-recent-builds');
  const svcEl = document.getElementById('overview-services-health');
  const jenkinsEl = document.getElementById('overview-jenkins-health');
  const gitlabEl = document.getElementById('overview-gitlab-health');
  if (!recentEl && !svcEl && !jenkinsEl && !gitlabEl) return;

  const emptyMsg = typeof t === 'function' ? t('hero.no_data') : 'No data yet';

  if (recentEl) {
    const recent = [...builds]
      .filter((b) => b.started_at)
      .sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')))
      .slice(0, 6);
    if (!recent.length) {
      recentEl.innerHTML = `<tr><td colspan="4" class="overview-empty">${esc(emptyMsg)}</td></tr>`;
    } else {
      recentEl.innerHTML = recent.map((b) => {
        const st = normalizeBuildStatus(b.status);
        const cls = _buildStatusLabel(st);
        const label = _buildStatusText(st);
        const job = esc(b.job_name || '—');
        const age = b.started_at && typeof ago === 'function' ? esc(ago(b.started_at)) : '—';
        const link = b.url
          ? `<a href="${esc(b.url)}" target="_blank" rel="noopener" class="ov-link">↗</a>`
          : '';
        return `<tr>
          <td><span class="ov-status ${cls}">${esc(label)}</span></td>
          <td>${job}</td>
          <td>${age}</td>
          <td>${link}</td>
        </tr>`;
      }).join('');
    }
  }

  if (svcEl) {
    const list = [...services].slice(0, 8);
    if (!list.length) {
      svcEl.innerHTML = `<tr><td colspan="3" class="overview-empty">${esc(emptyMsg)}</td></tr>`;
    } else {
      svcEl.innerHTML = list.map((sv) => {
        const ss = normalizeServiceStatus(sv.status);
        const cls = ss === 'up' ? 'ok' : ss === 'down' ? 'fail' : 'warn';
        const dots = `<span class="svc-dots"><span class="${cls}"></span><span class="${cls}"></span><span class="${cls}"></span><span class="${cls === 'ok' ? 'up' : cls}"></span><span class="up"></span></span>`;
        return `<tr>
          <td>${esc(sv.name || '—')}</td>
          <td><span class="ov-status ${cls}">${esc(ss)}</span></td>
          <td>${dots}</td>
        </tr>`;
      }).join('');
    }
  }

  if (jenkinsEl) {
    const jobs = _overviewLatestJobs(builds, 'jenkins');
    jenkinsEl.innerHTML = jobs.length
      ? jobs.map(_overviewCiHealthRow).join('')
      : `<tr><td colspan="3" class="overview-empty">${esc(emptyMsg)}</td></tr>`;
  }

  if (gitlabEl) {
    const jobs = _overviewLatestJobs(builds, 'gitlab');
    gitlabEl.innerHTML = jobs.length
      ? jobs.map(_overviewCiHealthRow).join('')
      : `<tr><td colspan="3" class="overview-empty">${esc(emptyMsg)}</td></tr>`;
  }
}

function goToBuildsSource(source) {
  const kind = String(source || '').toLowerCase();
  filterBuilds(kind, '', '', '');
}
