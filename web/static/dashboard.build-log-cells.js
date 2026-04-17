// Jenkins/GitLab URL helpers + HTML for log/stage/diff buttons in build rows.
// Load after dashboard.panel-state.js, before dashboard.js (helpers icOpenFirstFailureLog + actions _buildFavRow call these at runtime).

// ─────────────────────────────────────────────────────────────────────────────
// BUILDS — log buttons (Jenkins console / GitLab traces)
// ─────────────────────────────────────────────────────────────────────────────
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
  if (src === 'jenkins') {
    const p = { job_name: b.job_name, build_number: bn, instance_url: jenkinsBaseFromBuildUrl(b.url) };
    const showDiff = b.status === 'failure' || b.status === 'unstable';
    const diffArgs = JSON.stringify(['jenkins', b.job_name, bn, jenkinsBaseFromBuildUrl(b.url)]);
    return `<span style="display:inline-flex;gap:3px">
      <button type="button" class="act-btn log-btn" onclick='openLogViewer("jenkins",${JSON.stringify(p)})' title="${_svgTitleAttr(t('dash.log_console'))}">&#128466;</button>
      ${showDiff ? `<button type="button" class="act-btn log-btn" style="font-size:.65rem" onclick='openLogDiff(...${diffArgs})' title="${_svgTitleAttr(t('log.compare_title'))}">&#8644;</button>` : ''}
    </span>`;
  }
  if (src === 'gitlab') {
    const p = { project_id: b.job_name, pipeline_id: bn, instance_url: gitlabBaseFromPipelineUrl(b.url) };
    const stagesArgs = JSON.stringify([b.job_name, bn, gitlabBaseFromPipelineUrl(b.url), 'GitLab: ' + b.job_name + ' #' + bn]);
    const showDiff = b.status === 'failure' || b.status === 'unstable';
    const diffArgs = JSON.stringify(['gitlab', b.job_name, bn, gitlabBaseFromPipelineUrl(b.url)]);
    return `<span style="display:inline-flex;gap:3px">
      <button type="button" class="act-btn log-btn" onclick='openLogViewer("gitlab",${JSON.stringify(p)})' title="${_svgTitleAttr(t('dash.pipeline_job_logs'))}">&#128466;</button>
      <button type="button" class="act-btn log-btn" style="background:var(--info);color:#fff" onclick='openStagesModal(...${stagesArgs})' title="${_svgTitleAttr(t('dash.pipeline_stages_short'))}">&#9646;</button>
      ${showDiff ? `<button type="button" class="act-btn log-btn" style="font-size:.65rem" onclick='openLogDiff(...${diffArgs})' title="${_svgTitleAttr(t('log.compare_title'))}">&#8644;</button>` : ''}
    </span>`;
  }
  return '—';
}
