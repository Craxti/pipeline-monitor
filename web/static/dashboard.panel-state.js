// _state, infinite-scroll observers, build-group collapse, panel expand/collapse, fetchApiErrorDetail.
// Load after dashboard.fetch.js, before dashboard.js (init passes loadBuilds etc. into _initObserver at runtime).

// ─────────────────────────────────────────────────────────────────────────────
// Panel state (per-panel page cursor & IntersectionObserver)
// ─────────────────────────────────────────────────────────────────────────────
const _state = {
  builds:   { page:1, per_page:60, loading:false, done:false, total:0 },
  failures: { page:1, per_page:20, loading:false, done:false, total:0 },
  tests:    { page:1, per_page:30, loading:false, done:false, total:0 },
  svcs:     { page:1, per_page:50, loading:false, done:false, total:0 },
};

let _collapsedBuildGroups = new Set();
function _loadCollapsedBuildGroups() {
  try {
    const raw = localStorage.getItem('cimon-collapsed-build-groups');
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) _collapsedBuildGroups = new Set(arr.map(String));
  } catch { _collapsedBuildGroups = new Set(); }
}
function _saveCollapsedBuildGroups() {
  try { localStorage.setItem('cimon-collapsed-build-groups', JSON.stringify([..._collapsedBuildGroups])); } catch { /* ignore */ }
}
function toggleBuildGroup(encKey) {
  const k = String(encKey || '');
  if (!k) return;
  if (_collapsedBuildGroups.has(k)) _collapsedBuildGroups.delete(k);
  else _collapsedBuildGroups.add(k);
  _saveCollapsedBuildGroups();
  applyBuildGroupVisibility(k);
}
function applyBuildGroupVisibility(encKey) {
  const tbody = document.getElementById('tbody-builds');
  if (!tbody) return;
  const k = String(encKey || '');
  const collapsed = _collapsedBuildGroups.has(k);
  // Toggle build rows (compare attributes — encoded keys contain `%` and break CSS.escape selectors)
  tbody.querySelectorAll('tr[data-bgroup]').forEach((tr) => {
    if (tr.getAttribute('data-bgroup') !== k) return;
    if (tr.classList.contains('src-group-row')) return;
    tr.style.display = collapsed ? 'none' : '';
  });
  tbody.querySelectorAll('tr.src-group-row[data-bgroup]').forEach((tr) => {
    if (tr.getAttribute('data-bgroup') !== k) return;
    const hdr = tr.querySelector('.grp-toggle');
    if (hdr) hdr.textContent = collapsed ? '+' : '−';
  });
}
const _obs = {};

async function fetchApiErrorDetail(res) {
  let detail = '';
  try {
    if (res) {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const j = await res.json();
        detail = (j.detail || j.message || '') + '';
      } else {
        detail = (await res.text() || '').slice(0, 200);
      }
    }
  } catch { /* ignore */ }
  return detail;
}

function _initObserver(key, loadFn) {
  if (_obs[key]) _obs[key].disconnect();
  const sentinel = document.getElementById(`sentinel-${key}`);
  _obs[key] = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) loadFn();
  }, { root: document.getElementById(`wrap-${key}`), threshold: 0, rootMargin: key === 'builds' ? '100px' : '0px' });
  _obs[key].observe(sentinel);
}

// ─────────────────────────────────────────────────────────────────────────────
// Expand / collapse
// ─────────────────────────────────────────────────────────────────────────────
const _expanded = {};
function toggleExpand(key) {
  _expanded[key] = !_expanded[key];
  const wrap = document.getElementById(`wrap-${key}`);
  const btn  = document.getElementById(`expand-${key}`);
  wrap.classList.toggle('expanded', _expanded[key]);
  btn.textContent = _expanded[key] ? t('dash.collapse') : t('dash.expand_panel');
  // re-check sentinel visibility after layout change
  if (_obs[key]) { const s = document.getElementById(`sentinel-${key}`); _obs[key].unobserve(s); _obs[key].observe(s); }
}
