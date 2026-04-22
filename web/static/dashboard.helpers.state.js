// Split from dashboard.helpers.js — preserve script order in web/templates/index.html
let _jobAnalytics = {};
let _lastSit = { failB: 0, failT: 0, downS: 0 };
let _uptimeData = {}; // service name → [{date, status}]
let _lastBuildsForIc = [];
let _lastIncidentReasons = [];
let _lastIcReasonFacts = null;
let _lastIncidentSeverity = 'ok';
let _collectAutoRefreshTs = 0;
let _collectLogsOffset = 0;
let _collectLogsTotal = 0;
let _collectLogsPollTs = 0;
let _collectLogsWarn = 0;
let _collectLogsErr = 0;
let _collectLogsInstances = new Set();
let _collectLogsLastCollectId = '';
let _collectLogsSlowPollTs = 0;

/** Builds table LIVE: skip full tbody rewrite when /api/builds payload unchanged (reduces flicker). */
let _lastBuildsPageSig = '';

function _clampLiveDashboardPollSec(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 20;
  return Math.min(120, Math.max(8, Math.round(n)));
}

/** Seconds between LIVE dashboard refreshAll() polls (from api/meta web_ui). */
let _liveDashboardPollSec = 20;

function liveDashboardPollMs() {
  return Math.round(_clampLiveDashboardPollSec(_liveDashboardPollSec) * 1000);
}

const DASH_TABS = ['overview', 'builds', 'tests', 'services', 'trends', 'incidents', 'logs'];
let _dashTab = 'overview';
let _backTopInit = false;

function setDashboardTab(name, opts) {
  opts = opts || {};
  const skipUrl = opts.skipUrl;
  const skipStore = opts.skipStore;
  if (!DASH_TABS.includes(name)) name = 'overview';
  _dashTab = name;
  DASH_TABS.forEach((id) => {
    const panel = document.getElementById('tab-panel-' + id);
    if (panel) panel.hidden = (id !== name);
  });
  document.querySelectorAll('#dash-page-tabs .dash-tab').forEach((btn) => {
    const sel = btn.dataset.tab === name;
    btn.setAttribute('aria-selected', sel ? 'true' : 'false');
    btn.classList.toggle('active', sel);
  });
  try {
    if (!skipStore) localStorage.setItem('cimon-dash-tab', name);
  } catch { /* ignore */ }
  if (!skipUrl) _writeURLFilters();
  if (name === 'trends') {
    requestAnimationFrame(() => { _trendsCharts.forEach((c) => c && c.resize()); });
  }
  // Prevent stale panel requests from overriding current UI.
  if (name !== 'builds') abortFetchKey('builds');
  if (name !== 'tests') abortFetchKey('tests');
  if (name !== 'tests') abortFetchKey('failures');
  if (name !== 'services') abortFetchKey('services');
  if (name !== 'trends') abortFetchKey('trends');
}

function goToInTab(tab, elId) {
  setDashboardTab(tab);
  requestAnimationFrame(() => document.getElementById(elId)?.scrollIntoView({ behavior: 'smooth' }));
}

// Debounce factory (returns the same debounced fn each call via closure map)
const _debMap = new Map();
function debounce(fn, ms) {
  if (!_debMap.has(fn)) {
    let t;
    _debMap.set(fn, (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); });
  }
  return _debMap.get(fn);
}
