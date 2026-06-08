// Split from dashboard.helpers.js — preserve script order in web/templates/index.html
let _jobAnalytics = {};
let _lastSit = { failB: 0, failT: 0, downS: 0 };
let _uptimeData = {}; // service name → [{date, status}]
let _lastBuildsForIc = [];
let _lastIncidentReasons = [];
let _lastIcReasonFacts = null;
let _lastIncidentSeverity = 'ok';
let _collectAutoRefreshTs = 0;
let _logIntelSelectedKey = '';
let _logIntelSelectedModelId = 0;
let _logIntelPollTs = 0;
let _logIntelGraph = null;
let _logIntelCorrData = null;

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

const DASH_TABS = [
  'overview',
  'builds',
  'test-failures',
  'test-runs',
  'services',
  'system',
  'trends',
  'incidents',
  'log-intel',
  'har',
];

const DASH_TAB_META = {
  overview: { titleKey: 'tabNav.overview', subKey: 'tabNav.overview_sub' },
  builds: { titleKey: 'tabNav.builds', subKey: 'tabNav.builds_sub' },
  'test-failures': { titleKey: 'tabNav.test_failures', subKey: 'tabNav.test_failures_sub' },
  'test-runs': { titleKey: 'tabNav.test_runs', subKey: 'tabNav.test_runs_sub' },
  services: { titleKey: 'tabNav.services', subKey: 'tabNav.services_sub' },
  system: { titleKey: 'tabNav.system', subKey: 'tabNav.system_sub' },
  trends: { titleKey: 'tabNav.trends', subKey: 'tabNav.trends_sub' },
  incidents: { titleKey: 'tabNav.incidents', subKey: 'tabNav.incidents_sub' },
  'log-intel': { titleKey: 'tabNav.service_intel', subKey: 'tabNav.service_intel_sub' },
  har: { titleKey: 'tabNav.har', subKey: 'tabNav.har_sub' },
};

let _dashTab = 'overview';
let _backTopInit = false;

function _updateDashSectionHeader(name) {
  const meta = DASH_TAB_META[name] || DASH_TAB_META.overview;
  const titleEl = document.getElementById('dash-section-title');
  const subEl = document.getElementById('dash-section-sub');
  if (titleEl) {
    titleEl.textContent = t(meta.titleKey);
    titleEl.setAttribute('data-i18n', meta.titleKey);
  }
  if (subEl) {
    subEl.textContent = t(meta.subKey);
    subEl.setAttribute('data-i18n', meta.subKey);
  }
}

function setDashboardTab(name, opts) {
  opts = opts || {};
  const skipUrl = opts.skipUrl;
  const skipStore = opts.skipStore;
  if (!DASH_TABS.includes(name)) name = 'overview';
  _dashTab = name;
  DASH_TABS.forEach((id) => {
    const panel = document.getElementById('tab-panel-' + id);
    if (panel) {
      panel.hidden = (id !== name);
      panel.classList.toggle('tab-panel-active', id === name);
    }
  });
  document.querySelectorAll('#dash-page-tabs .dash-nav-item').forEach((btn) => {
    const sel = btn.dataset.tab === name;
    btn.setAttribute('aria-selected', sel ? 'true' : 'false');
    btn.classList.toggle('active', sel);
  });
  _updateDashSectionHeader(name);
  try {
    if (!skipStore) localStorage.setItem('cimon-dash-tab', name);
  } catch { /* ignore */ }
  if (!skipUrl) _writeURLFilters();
  document.querySelectorAll('.chart-card.chart-fs').forEach((card) => {
    card.classList.remove('chart-fs');
  });
  // Close mobile sidebar after navigation
  try {
    document.body.classList.remove('dash-nav-open');
    const bd = document.getElementById('dash-sidebar-backdrop');
    if (bd) bd.hidden = true;
  } catch { /* ignore */ }
  // Prevent stale panel requests from overriding current UI.
  if (name !== 'builds') abortFetchKey('builds');
  if (name !== 'test-runs') abortFetchKey('tests');
  if (name !== 'test-failures') abortFetchKey('failures');
  if (name !== 'services') abortFetchKey('services');

  if (name === 'builds' && typeof loadBuilds === 'function') {
    const s = _state.builds;
    const tb = document.getElementById('tbody-builds');
    if (needsFullTableLoad(s, tb)) scheduleTablePageChain(s, loadBuilds, tb);
  }
  if (name === 'test-runs' && typeof loadTests === 'function') {
    const s = _state.tests;
    const tb = document.getElementById('tbody-tests');
    if (needsFullTableLoad(s, tb)) scheduleTablePageChain(s, loadTests, tb);
  }
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
