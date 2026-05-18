// Split from dashboard.helpers.js — preserve script order in web/templates/index.html
// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function _svgTitleAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const badge = (s) => {
  s = (s||'').toLowerCase();
  const cls = ['success','passed','up'].includes(s) ? 'b-ok'
    : ['failure','failed','error','down'].includes(s) ? 'b-fail'
    : ['unstable','degraded','skipped'].includes(s) ? 'b-warn'
    : ['running','pending'].includes(s) ? 'b-info'
    : 'b-dim';
  const code = ['success','passed','up'].includes(s) ? 'OK'
    : ['failure','failed','error','down'].includes(s) ? 'FAIL'
    : ['unstable','degraded','skipped'].includes(s) ? '~'
    : ['running','pending'].includes(s) ? '…'
    : '·';
  return `<span class="b ${cls}" role="status" data-status="${_svgTitleAttr(s)}"><span class="b-code" aria-hidden="true">${code}</span>${esc(s)}</span>`;
};
const fmt = (v) => {
  if (!v) return '—';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v).replace('T', ' ').slice(0, 16);
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch { return '—'; }
};
function fmtUtcIso(v) {
  if (!v) return '—';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v).slice(0, 19);
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' ' + t('time.utc_suffix');
  } catch { return '—'; }
}
const dur = (s) => {
  if (s == null || Number.isNaN(Number(s))) return '—';
  const x = Number(s);
  if (x < 60) return `${Math.round(x)}s`;
  return `${Math.floor(x / 60)}m ${Math.round(x % 60)}s`;
};
// Escaping helpers:
// - esc(): safe for HTML text nodes (also safe-ish in attributes; use _svgTitleAttr for title="" specifically)
// Note: we escape quotes too because this project often interpolates values into HTML attributes.
const esc  = s => s == null ? '—' : String(s)
  .replace(/&/g,'&amp;')
  .replace(/</g,'&lt;')
  .replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;')
  .replace(/'/g,'&#39;');

function safeUrl(u) {
  // Allow only http(s) URLs; otherwise return empty string.
  try {
    const s = String(u || '').trim();
    if (!s) return '';
    const x = new URL(s, window.location.origin);
    if (x.protocol !== 'http:' && x.protocol !== 'https:') return '';
    return x.href;
  } catch {
    return '';
  }
}
const fmtSec = s => s >= 60 ? `${Math.floor(s/60)}m ${s%60}s` : `${s}s`;

function normalizeBuildStatus(raw) {
  const s0 = String(raw == null ? '' : raw).trim().toLowerCase();
  const aliases = {
    pass: 'success',
    passed: 'success',
    ok: 'success',
    fail: 'failure',
    failed: 'failure',
    error: 'failure',
    cancelled: 'aborted',
    canceled: 'aborted',
  };
  const s = aliases[s0] || s0;
  if (['success', 'failure', 'running', 'aborted', 'unstable', 'unknown'].includes(s)) return s;
  return 'unknown';
}

function normalizeServiceStatus(raw) {
  const s0 = String(raw == null ? '' : raw).trim().toLowerCase();
  if (['up', 'healthy', 'ok', 'running'].includes(s0)) return 'up';
  if (['down', 'unhealthy', 'offline', 'stopped'].includes(s0)) return 'down';
  if (['degraded', 'warn', 'warning', 'unstable'].includes(s0)) return 'degraded';
  return s0 || 'unknown';
}

function isBuildProblemStatus(raw) {
  const s = normalizeBuildStatus(raw);
  return s === 'failure' || s === 'unstable';
}

function incidentSeverityLevel(facts) {
  const f = facts || {};
  if (f.servicesDown > 0 || f.criticalBuildFailures || f.criticalTestFailures) return 'critical';
  if (f.failedBuilds > 0 || f.failedTests > 0 || f.hasUnstableBuilds) return 'high';
  if (f.partialErrors > 0 || f.snapshotStale) return 'warn';
  return 'ok';
}
