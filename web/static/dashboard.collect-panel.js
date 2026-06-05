// Collect auto-refresh during collect + tests-parse note: dashboard.collect-panel.js
// Load after dashboard.services.js, before dashboard.status-map.js.

function updateTestsParseNote(summaryObj) {
  const el = document.getElementById('tests-parse-note');
  if (!el) return;
  const pc = summaryObj && summaryObj.parse_coverage;
  if (!pc || typeof pc !== 'object') {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  const parts = [];
  for (const [k, v] of Object.entries(pc)) {
    if (!v || typeof v !== 'object') continue;
    const idx = v.jobs_indexed;
    const cj = v.console_jobs_parsed;
    const aj = v.allure_jobs_parsed;
    if (idx == null && cj == null && aj == null) continue;
    parts.push(`${k}: ~${idx ?? '—'} jobs in index; console ${cj ?? 0} jobs; Allure ${aj ?? 0} jobs`);
  }
  if (!parts.length) {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  el.style.display = 'block';
  el.textContent = parts.join(' · ');
}

function _autoRefreshVisiblePanelsDuringCollect(summaryObj) {
  const c = summaryObj && summaryObj.collect;
  if (!c || !c.is_collecting) return;
  const now = Date.now();
  if (now - _collectAutoRefreshTs < 5000) return; // 5s throttle
  _collectAutoRefreshTs = now;

  // Keep only the active tab live to avoid hammering the backend.
  if (_dashTab === 'test-failures') {
    resetFailures(true);
  } else if (_dashTab === 'test-runs') {
    resetTestsSoft(true);
  } else if (_dashTab === 'services') {
    resetServices(true);
  }
}
