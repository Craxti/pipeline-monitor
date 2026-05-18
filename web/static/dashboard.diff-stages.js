// Log diff modal + GitLab pipeline stages modal (Escape handlers).
// Load after dashboard.status-map.js, before dashboard.timeline.js.

// ─────────────────────────────────────────────────────────────────────────────
// Log Diff
// ─────────────────────────────────────────────────────────────────────────────
function closeDiffModal() {
  const m = document.getElementById('diff-modal');
  if (m) { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); }
}

async function openLogDiff(source, jobName, buildNumber, instanceUrl) {
  const modal = document.getElementById('diff-modal');
  const pre   = document.getElementById('diff-pre');
  const title = document.getElementById('diff-modal-title');
  if (!modal || !pre) return;

  title.textContent = tf('dash.diff_title_fmt', { source, job: jobName, num: buildNumber });
  pre.textContent = t('dash.loading_diff');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');

  try {
    const q = new URLSearchParams({ source, job_name: jobName, build_number: String(buildNumber) });
    if (instanceUrl) q.set('instance_url', instanceUrl);
    const r = await fetch(apiUrl('api/logs/diff?' + q));
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      pre.textContent = t('dash.log_error_prefix') + (e.detail || r.statusText);
      return;
    }
    const data = await r.json();
    const refLabel =
      data.reference_kind === 'last_build' ? t('dash.diff_ref_last_build') : t('dash.diff_ref_last_ok');
    title.textContent = tf('dash.diff_title_result', {
      cur: data.current_build, ref: data.reference_build, refKind: refLabel, job: jobName,
    });

    const lines = data.diff || [];
    if (!lines.length) {
      pre.textContent = t('dash.diff_no_changes');
      return;
    }

    pre.innerHTML = lines.map(line => {
      const escaped = _escHtml(line);
      if (line.startsWith('+++') || line.startsWith('---')) return `<span class="diff-hdr">${escaped}</span>`;
      if (line.startsWith('@@')) return `<span class="diff-hdr">${escaped}</span>`;
      if (line.startsWith('+')) return `<span class="diff-add">${escaped}</span>`;
      if (line.startsWith('-')) return `<span class="diff-del">${escaped}</span>`;
      return `<span class="diff-ctx">${escaped}</span>`;
    }).join('');
  } catch (e) {
    pre.textContent = t('dash.log_error_prefix') + e.message;
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeDiffModal();
});

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Stages (GitLab) — lazy loaded on demand
// ─────────────────────────────────────────────────────────────────────────────
function closeStagesModal() {
  const m = document.getElementById('stages-modal');
  if (m) { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); }
}

async function openStagesModal(projectId, pipelineId, instanceUrl, title) {
  const modal = document.getElementById('stages-modal');
  const body  = document.getElementById('stages-body');
  const hdr   = document.getElementById('stages-modal-title');
  if (!modal || !body) return;

  hdr.textContent = title || `Pipeline #${pipelineId}`;
  body.innerHTML = `<div style="color:var(--muted);padding:.5rem">${_escHtml(t('dash.loading_stages'))}</div>`;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');

  try {
    const q = new URLSearchParams({ project_id: projectId, pipeline_id: String(pipelineId) });
    if (instanceUrl) q.set('instance_url', instanceUrl);
    const r = await fetch(apiUrl('api/pipeline/stages?' + q));
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      body.innerHTML = `<div style="color:var(--fail)">${_escHtml(e.detail || t('dash.stages_load_err'))}</div>`;
      return;
    }
    const data = await r.json();
    const stages = data.stages || [];
    if (!stages.length) {
      body.innerHTML = `<div style="color:var(--muted)">${_escHtml(t('dash.stages_no_jobs'))}</div>`;
      return;
    }

    const JOB_CLS = { success: 'sj-ok', failed: 'sj-fail', running: 'sj-run', canceled: 'sj-skip', skipped: 'sj-skip', pending: 'sj-run' };
    const JOB_ICO = { success: '✓', failed: '✗', running: '▶', canceled: '■', skipped: '–', pending: '⧖' };
    const STATUS_ORD = { failed: 0, running: 1, pending: 2, success: 3, canceled: 4, skipped: 5 };

    body.innerHTML = stages.map(st => {
      const stageStatus = st.jobs.some(j => j.status === 'failed') ? 'failed'
        : st.jobs.some(j => j.status === 'running') ? 'running'
        : st.jobs.every(j => j.status === 'success') ? 'success' : 'pending';
      const stageColor = { failed: 'var(--fail)', success: 'var(--ok)', running: 'var(--info)' }[stageStatus] || 'var(--muted)';

      const jobsHtml = st.jobs
        .sort((a, b) => (STATUS_ORD[a.status]??9) - (STATUS_ORD[b.status]??9) || a.name.localeCompare(b.name))
        .map(j => {
          const cls = JOB_CLS[j.status] || '';
          const ico = JOB_ICO[j.status] || '?';
          const dur = j.duration ? ` ${Math.round(j.duration)}s` : '';
          const tag = j.web_url ? 'a' : 'span';
          const href = j.web_url ? ` href="${_escHtml(j.web_url)}" target="_blank"` : '';
          return `<${tag}${href} class="stage-job ${cls}" title="${_escHtml(j.status)}${dur}">${ico} ${_escHtml(j.name)}${dur ? `<small style="opacity:.7"> ${dur}</small>` : ''}</${tag}>`;
        }).join('');

      return `<div class="stage-row">
        <div class="stage-label" style="color:${stageColor}">${_escHtml(st.stage)}</div>
        <div class="stage-jobs">${jobsHtml}</div>
      </div>`;
    }).join('');
  } catch (e) {
    body.innerHTML = `<div style="color:var(--fail)">${_escHtml(e.message)}</div>`;
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeStagesModal();
});
