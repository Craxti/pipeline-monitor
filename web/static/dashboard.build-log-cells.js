// Jenkins/GitLab URL helpers + mockup build row HTML.
// Load after dashboard.panel-state.js, before dashboard.builds.js.

const BUILDS_TBL_COLS = 7;

function jenkinsBaseFromBuildUrl(u) {
  if (!u) return '';
  try {
    const o = new URL(u);
    const path = o.pathname;
    const idx = path.indexOf('/job/');
    const basePath = idx > 0 ? path.slice(0, idx) : '';
    return (o.origin + basePath).replace(/\/$/, '');
  } catch { return ''; }
}
function gitlabBaseFromPipelineUrl(u) {
  if (!u) return '';
  try { return new URL(u).origin; } catch { return ''; }
}

function _buildLogCell(b) {
  const src = (b.source || '').toLowerCase();
  const bn = b.build_number;
  if (bn == null) return '—';
  if (src === 'jenkins' || src.startsWith('jenkins_')) {
    const p = { job_name: b.job_name, build_number: bn, instance_url: jenkinsBaseFromBuildUrl(b.url) };
    const showDiff = b.status === 'failure' || b.status === 'unstable';
    const diffArgs = JSON.stringify(['jenkins', b.job_name, bn, jenkinsBaseFromBuildUrl(b.url)]);
    return `<span style="display:inline-flex;gap:3px">
      <button type="button" class="act-btn log-btn" onclick='openLogViewer("jenkins",${JSON.stringify(p)})' title="${_svgTitleAttr(t('dash.log_console'))}">&#128466;</button>
      ${showDiff ? `<button type="button" class="act-btn log-btn" style="font-size:.65rem" onclick='openLogDiff(...${diffArgs})' title="${_svgTitleAttr(t('log.compare_title'))}">&#8644;</button>` : ''}
    </span>`;
  }
  if (src === 'gitlab' || src.startsWith('gitlab_')) {
    const p = { project_id: b.job_name, pipeline_id: bn, instance_url: gitlabBaseFromPipelineUrl(b.url) };
    const stagesArgs = JSON.stringify([b.job_name, bn, gitlabBaseFromPipelineUrl(b.url), 'GitLab: ' + b.job_name + ' #' + bn]);
    const showDiff = b.status === 'failure' || b.status === 'unstable';
    const diffArgs = JSON.stringify(['gitlab', b.job_name, bn, gitlabBaseFromPipelineUrl(b.url)]);
    return `<span style="display:inline-flex;gap:3px">
      <button type="button" class="act-btn log-btn" onclick='openLogViewer("gitlab",${JSON.stringify(p)})' title="${_svgTitleAttr(t('dash.pipeline_job_logs'))}">&#128466;</button>
      <button type="button" class="act-btn log-btn act-btn--stages" onclick='openStagesModal(...${stagesArgs})' title="${_svgTitleAttr(t('dash.pipeline_stages_short'))}">&#9646;</button>
      ${showDiff ? `<button type="button" class="act-btn log-btn" style="font-size:.65rem" onclick='openLogDiff(...${diffArgs})' title="${_svgTitleAttr(t('log.compare_title'))}">&#8644;</button>` : ''}
    </span>`;
  }
  return '—';
}

function _buildSourceKind(b) {
  const src = (b.source || '').toLowerCase();
  if (src === 'jenkins' || src.startsWith('jenkins_')) return 'jenkins';
  if (src === 'gitlab' || src.startsWith('gitlab_')) return 'gitlab';
  if (src === 'github' || src.startsWith('github_')) return 'github';
  return 'generic';
}

function _buildInstanceMeta(b) {
  const kind = _buildSourceKind(b);
  const label = String(b.instance || '').trim()
    || (kind === 'jenkins' ? 'Jenkins' : kind === 'gitlab' ? 'GitLab CI' : kind === 'github' ? 'GitHub' : String(b.source || '—'));
  return { kind, label };
}

function _buildInstanceIconHtml(kind) {
  if (kind === 'jenkins') {
    return '<img class="inst-brand-ico inst-brand-jenkins" src="/static/icons/jenkins.svg?v=2" alt="" width="20" height="20" loading="lazy" decoding="async" aria-hidden="true">';
  }
  if (kind === 'gitlab') {
    return '<img class="inst-brand-ico inst-brand-gitlab" src="/static/icons/gitlab.svg?v=2" alt="" width="20" height="20" loading="lazy" decoding="async" aria-hidden="true">';
  }
  if (kind === 'github') {
    return '<img class="inst-brand-ico inst-brand-github" src="/static/icons/github.svg?v=2" alt="" width="20" height="20" loading="lazy" decoding="async" aria-hidden="true">';
  }
  return '<span class="inst-ico inst-generic" aria-hidden="true"></span>';
}

function _buildNumLink(b) {
  const bn = b.build_number;
  if (bn == null || bn === '') return '—';
  const u = safeUrl(b.url);
  const num = esc(String(bn));
  if (u) return `<a href="${esc(u)}" class="build-num-link" target="_blank" rel="noopener">#${num}</a>`;
  return `<span class="build-num-plain">#${num}</span>`;
}

function _buildStatusIsDiff(b) {
  const st = String(b.status_normalized || b.status || '').toLowerCase();
  return st === 'failure' || st === 'failed' || st === 'unstable';
}

function _buildActionsMenu(b) {
  const items = [];
  const u = safeUrl(b.url);
  if (u) items.push(`<a class="build-menu-item" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t('dash.act_open'))}</a>`);

  const src = (b.source || '').toLowerCase();
  const bn = b.build_number;
  const showDiff = _buildStatusIsDiff(b);

  if (src === 'jenkins' || src.startsWith('jenkins_')) {
    if (bn != null) {
      const p = { job_name: b.job_name, build_number: bn, instance_url: jenkinsBaseFromBuildUrl(b.url) };
      items.push(`<button type="button" class="build-menu-item" onclick='openLogViewer("jenkins",${JSON.stringify(p)})'>${esc(t('dash.build_log_title'))}</button>`);
      if (showDiff) {
        const diffArgs = JSON.stringify(['jenkins', b.job_name, bn, jenkinsBaseFromBuildUrl(b.url)]);
        items.push(`<button type="button" class="build-menu-item" onclick='openLogDiff(...${diffArgs})'>${esc(t('log.compare_title'))}</button>`);
      }
    }
    if (src === 'jenkins') {
      const instanceUrl = jenkinsBaseFromBuildUrl(b.url);
      items.push(`<button type="button" class="build-menu-item" data-dash-action="triggerJenkinsBuild" data-dash-args='[${JSON.stringify(b.job_name)},${JSON.stringify(instanceUrl)}]'>${esc(t('dash.act_run'))}</button>`);
    }
  } else if (src === 'gitlab' || src.startsWith('gitlab_')) {
    if (bn != null) {
      const p = { project_id: b.job_name, pipeline_id: bn, instance_url: gitlabBaseFromPipelineUrl(b.url) };
      const stagesArgs = JSON.stringify([b.job_name, bn, gitlabBaseFromPipelineUrl(b.url), 'GitLab: ' + b.job_name + ' #' + bn]);
      items.push(`<button type="button" class="build-menu-item" onclick='openLogViewer("gitlab",${JSON.stringify(p)})'>${esc(t('dash.build_log_title'))}</button>`);
      items.push(`<button type="button" class="build-menu-item" onclick='openStagesModal(...${stagesArgs})'>${esc(t('dash.pipeline_stages_short'))}</button>`);
      if (showDiff) {
        const diffArgs = JSON.stringify(['gitlab', b.job_name, bn, gitlabBaseFromPipelineUrl(b.url)]);
        items.push(`<button type="button" class="build-menu-item" onclick='openLogDiff(...${diffArgs})'>${esc(t('log.compare_title'))}</button>`);
      }
    }
    if (src === 'gitlab') {
      const ref = b.branch || 'main';
      items.push(`<button type="button" class="build-menu-item" data-dash-action="triggerGitlabPipeline" data-dash-args='[${JSON.stringify(b.job_name)},${JSON.stringify(ref)},${JSON.stringify(gitlabBaseFromPipelineUrl(b.url))}]'>${esc(t('dash.act_run'))}</button>`);
    }
  }

  if (bn != null && bn !== '') {
    items.push(`<button type="button" class="build-menu-item" onclick="copyBuildRef(event,${JSON.stringify(b.job_name)},${JSON.stringify(bn)})">${esc(t('dash.copy_id_title'))}</button>`);
  }

  if (!items.length) return '—';

  const label = _svgTitleAttr(t('dash.th_action'));
  return `<details class="build-row-menu">
    <summary class="build-menu-btn" aria-label="${label}">&#8942;</summary>
    <div class="build-menu-pop" role="menu">${items.join('')}</div>
  </details>`;
}

function _buildMockupRow(b, opts = {}) {
  const { starred = false, favKeys = null, favRow = false } = opts;
  const status = b.status_normalized || b.status;
  const inst = _buildInstanceMeta(b);
  const jt = _svgTitleAttr(b.job_name);
  const isStarred = starred || !!(favKeys && favKeys[String(b.job_name ?? '')]);
  const favPayloadEnc = encodeURIComponent(JSON.stringify({
    source: b.source, job_name: b.job_name, build_number: b.build_number, status: b.status, branch: b.branch,
    started_at: b.started_at, duration_seconds: b.duration_seconds, url: b.url, critical: b.critical, instance: b.instance,
  }));
  const favJobEnc = encodeURIComponent(String(b.job_name ?? ''));
  const favTitle = _svgTitleAttr(isStarred ? t('dash.fav_remove') : t('dash.fav_add'));
  const rowAttrs = favRow
    ? `data-fav-job="${esc(b.job_name)}" data-job="${encodeURIComponent(b.job_name)}"`
    : `data-job="${encodeURIComponent(b.job_name)}"`;
  const jobHtml = b.critical
    ? `<strong class="job-name">${esc(b.job_name)}</strong>`
    : `<span class="job-name">${esc(b.job_name)}</span>`;
  const ageTxt = (typeof ago === 'function' ? ago(b.started_at) : '') || '—';

  return `<tr ${rowAttrs}>
    <td class="td-status">${badgeMockup(status)}</td>
    <td class="td-job-mockup" title="${jt}">
      <div class="job-mockup-inner">
        <button type="button" class="fav-btn${isStarred ? ' starred' : ''}" data-fav-job="${favJobEnc}" data-fav-payload="${favPayloadEnc}" onclick="toggleFavBtn(this)" title="${favTitle}" aria-label="${favTitle}"></button>
        ${jobHtml}
      </div>
    </td>
    <td class="td-instance">
      <span class="inst-cell">${_buildInstanceIconHtml(inst.kind)}<span class="inst-name">${esc(inst.label)}</span></span>
    </td>
    <td class="col-build-num mono">${_buildNumLink(b)}</td>
    <td class="td-dur-mockup"><span class="time-cell"><span class="time-ico dur-ico" aria-hidden="true"></span>${dur(b.duration_seconds)}</span></td>
    <td class="td-age"><span class="time-cell"><span class="time-ico age-ico" aria-hidden="true"></span>${esc(ageTxt)}</span></td>
    <td class="td-actions">${_buildActionsMenu(b)}</td>
  </tr>`;
}
