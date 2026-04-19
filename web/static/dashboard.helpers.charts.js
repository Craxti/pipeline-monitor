// Split from dashboard.helpers.js — preserve script order in web/templates/index.html
function _cssVar(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || '#94a3b8';
}
function _hexToRgba(hex, a) {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return `rgba(148,163,184,${a})`;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
function _statusColorHex(status) {
  const k = String(status || '').toLowerCase();
  const map = {
    success: '--st-success', failure: '--st-failure', running: '--st-running', unstable: '--st-unstable',
    aborted: '--st-unknown', passed: '--st-success', failed: '--st-failure', error: '--st-failure',
    down: '--st-failure', up: '--st-success', degraded: '--st-unstable', skipped: '--st-unknown',
  };
  return _cssVar(map[k] || '--st-unknown');
}
