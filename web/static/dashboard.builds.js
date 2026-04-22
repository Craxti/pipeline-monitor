// Builds table (reset / load / filters): dashboard.builds.js
// Load after dashboard.build-log-cells.js, before dashboard.failures.js.

// ─────────────────────────────────────────────────────────────────────────────
// BUILDS
// ─────────────────────────────────────────────────────────────────────────────
function resetBuilds(soft=false, force=false) {
  const s = _state.builds; s.page=1; s.done=false;
  if (force) _lastBuildsPageSig = '';
  if (force) {
    try { abortFetchKey('builds'); } catch { /* ignore */ }
    s.loading = false;
  }
  if (!soft) _lastBuildsPageSig = '';
  const tb = document.getElementById('tbody-builds');
  // Soft reset keeps current rows visible until the refreshed data arrives.
  if (!soft) {
    tb.innerHTML = `<tr class="empty-row"><td colspan="12">${esc(t('dash.table_loading'))}</td></tr>`;
  }
  loadBuilds();
}
function clearBuildFilters() {
  document.getElementById('f-source').value  = '';
  document.getElementById('f-instance').value = '';
  document.getElementById('f-bstatus').value = '';
  document.getElementById('f-job').value     = '';
  _buildsHours = 0;
  document.querySelectorAll('.time-filter-btn').forEach(b => b.classList.remove('active'));
  try { localStorage.setItem('cimon-builds-hours', '0'); } catch { /* ignore */ }
  // Persist empty values to localStorage and strip ?job=… from URL, otherwise F5 restores job from LS.
  try { _persistFiltersFromForm(); } catch { /* ignore */ }
  resetBuilds();
}
// Called from stat cards
function filterBuilds(source, status, job, instance) {
  document.getElementById('f-source').value  = source || '';
  document.getElementById('f-instance').value = instance || '';
  document.getElementById('f-bstatus').value = status || '';
  document.getElementById('f-job').value     = job    || '';
  try { _persistFiltersFromForm(); } catch { /* ignore */ }
  resetBuilds();
  goToInTab('builds', 'panel-builds');
}

async function loadBuilds() {
  const s = _state.builds;
  if (s.loading || s.done) return;
  s.loading = true;

  const source  = document.getElementById('f-source').value;
  const inst    = document.getElementById('f-instance').value;
  const status  = document.getElementById('f-bstatus').value;
  const job     = document.getElementById('f-job').value;
  const url = apiUrl(`api/builds?page=${s.page}&per_page=${s.per_page}&source=${encodeURIComponent(source)}&instance=${encodeURIComponent(inst)}&status=${encodeURIComponent(status)}&job=${encodeURIComponent(job)}&hours=${_buildsHours}`);

  const res = await fetchKeyed('builds', url).catch(()=>null);
  s.loading = false;

  const tbody = document.getElementById('tbody-builds');
  if (res === FETCH_ABORTED) return;
  if (!res || !res.ok) {
    const detail = await fetchApiErrorDetail(res);
    srAnnounce(t('dash.table_api_err') + (detail ? ': ' + detail : ''), 'assertive');
    const extra = detail ? ` — ${esc(detail)}` : '';
    tbody.innerHTML = `<tr class="empty-row"><td colspan="12">${esc(t('dash.table_api_err'))}${extra}<br/><span class="err-hint">${esc(t('err.hint_retry'))}</span> <button type="button" class="btn btn-ghost" onclick="refreshAll()">${esc(t('common.retry'))}</button></td></tr>`;
    _applyGlobalSearch();
    return;
  }
  const data = await res.json();
  s.total = data.total;
  document.getElementById('builds-count').textContent = data.total;

  const rows = data.items;
  if (s.page === 1 && !rows.length) {
    if (keepTableOnTransientEmpty(tbody, rows, s)) return;
    tbody.innerHTML = `<tr class="empty-row"><td colspan="12"><div>${esc(t('dash.table_no_builds'))}</div><div class="empty-hint">${t('dash.empty_builds_hint')}</div>${emptyStateActionsHtml()}</td></tr>`;
    s.done = true; updateFilterSummary(); _applyGlobalSearch(); return;
  }

  const favKeys = _loadFavKeys();
  const _srcKey = (x) => String(x || '').trim().toLowerCase();
  const _instKey = (x) => String(x || '').trim().toLowerCase();
  const _buildsRowSig = (b) => [
    _srcKey(b.source),
    _instKey(b.instance),
    String(b.job_name ?? ''),
    String(b.build_number ?? ''),
    String(b.status_normalized || b.status || ''),
    String(b.duration_seconds ?? ''),
    String(b.started_at || ''),
  ].join('\x1f');
  const sorted = [...rows].sort((a, b) => (a.source || '').localeCompare(b.source || '') || String(a.instance || '').localeCompare(String(b.instance || '')) || String(a.started_at || '').localeCompare(String(b.started_at || '')));
  const groupCountsApi = data.group_counts && typeof data.group_counts === 'object' ? data.group_counts : null;
  // Fallback: per-page counts (if API omits group_counts).
  const gStats = {};
  sorted.forEach((b) => {
    const gk = `${_srcKey(b.source)}||${_instKey(b.instance)}`;
    const stn = String(b.status_normalized || b.status || '').toLowerCase();
    if (!gStats[gk]) gStats[gk] = { ok: 0, warn: 0, fail: 0, total: 0 };
    gStats[gk].total++;
    if (stn === 'failure' || stn === 'failed') gStats[gk].fail++;
    else if (stn === 'unstable') gStats[gk].warn++;
    else if (stn === 'success' || stn === 'passed' || stn === 'ok') gStats[gk].ok++;
  });
  let skipHeaderEnc = null;
  if (s.page > 1 && tbody) {
    const dataRows = Array.from(tbody.querySelectorAll('tr[data-bgroup]')).filter((tr) => !tr.classList.contains('src-group-row'));
    const last = dataRows[dataRows.length - 1];
    if (last) skipHeaderEnc = last.getAttribute('data-bgroup');
  }
  let lastGroup = null;
  const htmlParts = [];
  sorted.forEach((b) => {
    const groupKey = `${_srcKey(b.source)}||${_instKey(b.instance)}`;
    if (groupKey !== lastGroup) {
      const enc = encodeURIComponent(groupKey);
      const skipDupHeader = (skipHeaderEnc != null && enc === skipHeaderEnc && lastGroup === null);
      if (skipDupHeader) skipHeaderEnc = null;
      if (!skipDupHeader) {
      const srcLbl = String(b.source || '').trim();
      const instLbl = String(b.instance || '').trim();
      const lbl = instLbl ? `${srcLbl} · ${instLbl}` : srcLbl;
      const st = (groupCountsApi && groupCountsApi[groupKey]) || gStats[groupKey] || { ok:0, warn:0, fail:0, total:0 };
      const collapsed = _collapsedBuildGroups.has(enc);
      htmlParts.push(
        `<tr class="src-group-row" data-bgroup="${enc}"><td colspan="12">
          <div class="grp-hdr">
            <div class="grp-left">
              <button type="button" class="grp-toggle" onclick='toggleBuildGroup(${JSON.stringify(enc)})' title="Collapse/expand">${collapsed ? '+' : '−'}</button>
              <span class="grp-title">${esc(t('dash.group_source'))}: ${esc(lbl)}</span>
            </div>
            <div class="grp-right">
              <span class="grp-count"><span class="grp-dot fail"></span>${st.fail}</span>
              <span class="grp-count"><span class="grp-dot warn"></span>${st.warn}</span>
              <span class="grp-count"><span class="grp-dot ok"></span>${st.ok}</span>
              <span class="grp-count">/ ${st.total}</span>
            </div>
          </div>
        </td></tr>`
      );
      }
      lastGroup = groupKey;
    }
    const src = b.source.toLowerCase();
    const isStarred = !!favKeys[String(b.job_name ?? '')];
    let actionBtn = '';
    if (src === 'jenkins' || src.startsWith('jenkins_')) {
      const instanceUrl = jenkinsBaseFromBuildUrl(b.url);
      const logPayload = JSON.stringify({
        job_name: b.job_name,
        build_number: b.build_number,
        instance_url: instanceUrl,
      });
      actionBtn = `<span style="display:inline-flex;gap:6px;align-items:center">
        <button class="act-btn" onclick='openLogViewer("jenkins",${logPayload})' title="${_svgTitleAttr(t('dash.log_console'))}">&#128466;</button>
        ${src === 'jenkins' ? `<button class="act-btn" data-dash-action="triggerJenkinsBuild" data-dash-args='[${JSON.stringify(b.job_name)},${JSON.stringify(instanceUrl)}]'>&#9654; ${esc(t('dash.act_run'))}</button>` : ''}
      </span>`;
    } else if (src === 'gitlab' || src.startsWith('gitlab_')) {
      const ref = b.branch || 'main';
      const glInstanceUrl = gitlabBaseFromPipelineUrl(b.url);
      const logPayload = JSON.stringify({
        project_id: b.job_name,
        pipeline_id: b.build_number,
        instance_url: glInstanceUrl,
      });
      actionBtn = `<span style="display:inline-flex;gap:6px;align-items:center">
        <button class="act-btn" onclick='openLogViewer("gitlab",${logPayload})' title="${_svgTitleAttr(t('dash.pipeline_job_logs'))}">&#128466;</button>
        ${src === 'gitlab' ? `<button class="act-btn" data-dash-action="triggerGitlabPipeline" data-dash-args='[${JSON.stringify(b.job_name)},${JSON.stringify(ref)},${JSON.stringify(glInstanceUrl)}]'>&#9654; ${esc(t('dash.act_run'))}</button>` : ''}
      </span>`;
    }
    const favPayloadEnc = encodeURIComponent(JSON.stringify({
      source: b.source, job_name: b.job_name, build_number: b.build_number, status: b.status, branch: b.branch,
      started_at: b.started_at, duration_seconds: b.duration_seconds, url: b.url, critical: b.critical,
    }));
    const favJobEnc = encodeURIComponent(String(b.job_name ?? ''));
    const favTitle = _svgTitleAttr(isStarred ? t('dash.fav_remove') : t('dash.fav_add'));
    const jt = _svgTitleAttr(b.job_name);
    const bt = _svgTitleAttr(b.branch || '');
    const cpyTitle = _svgTitleAttr(t('dash.copy_id_title'));
    const bn = b.build_number;
    const numHtml = (bn != null && bn !== '')
      ? `<span class="num-copy-wrap"><span>${esc(String(bn))}</span><button type="button" class="btn-copy-ref" title="${cpyTitle}" aria-label="${cpyTitle}" onclick="copyBuildRef(event,${JSON.stringify(b.job_name)},${JSON.stringify(bn)})">&#128203;</button></span>`
      : '—';
    const srcLbl = (String(b.instance || '').trim())
      ? `${String(b.source || '').trim()} · ${String(b.instance || '').trim()}`
      : String(b.source || '').trim();
    htmlParts.push(`<tr data-job="${encodeURIComponent(b.job_name)}" data-bgroup="${encodeURIComponent(groupKey)}">
    <td class="col-pin-star"><button type="button" class="fav-btn${isStarred?' starred':''}" data-fav-job="${favJobEnc}" data-fav-payload="${favPayloadEnc}" onclick="toggleFavBtn(this)" title="${favTitle}">&#9733;</button></td>
    <td class="col-pin-src"><span class="b b-dim">${esc(srcLbl)}</span></td>
    <td class="col-pin-job" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${jt}">
      ${b.critical ? `<strong>${esc(b.job_name)}</strong>` : esc(b.job_name)}
    </td>
    <td class="mono col-pin-num">${numHtml}</td>
    <td class="col-pin-st">${badge(b.status)}</td>
    <td class="mono context-cell col-compact-hide" style="font-size:.76rem;color:var(--muted);max-width:140px">${_fmtBuildContext(b.analytics)}</td>
    <td class="mono col-compact-hide" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${bt}">${esc(b.branch)}</td>
    <td style="white-space:nowrap">${fmt(b.started_at)}</td>
    <td class="td-duration" style="white-space:nowrap"><span class="dur-val">${dur(b.duration_seconds)}</span>${_sparkSVG(b.job_name, b.status)}</td>
    <td>${b.url ? `<a href="${esc(safeUrl(b.url))}" target="_blank" rel="noopener">&#8599;</a>` : '—'}</td>
    <td>${_buildLogCell(b)}</td>
    <td>${actionBtn}</td>
  </tr>`);
  });
  const html = htmlParts.join('');
  if (s.page === 1) {
    const pageSig = sorted.map(_buildsRowSig).join('\x1e');
    if (_liveMode && pageSig && pageSig === _lastBuildsPageSig) {
      s.loading = false;
      updateFilterSummary();
      _applyGlobalSearch();
      if (!data.has_more) s.done = true;
      return;
    }
    _lastBuildsPageSig = pageSig;
    swapTableContentSmooth(tbody, () => { tbody.innerHTML = html; });
  } else tbody.insertAdjacentHTML('beforeend', html);
  // Apply collapsed state for any groups present in this page.
  try {
    const keys = new Set(sorted.map((b) => encodeURIComponent(`${_srcKey(b.source)}||${_instKey(b.instance)}`)));
    keys.forEach((k) => { if (_collapsedBuildGroups.has(k)) applyBuildGroupVisibility(k); });
  } catch { /* ignore */ }

  _applyGlobalSearch();
  updateFilterSummary();
  if (!data.has_more) { s.done = true; return; }
  s.page++;
}

