// All test runs + export link helpers: dashboard.tests.js
// Load after dashboard.failures.js, before dashboard.services.js.

// ─────────────────────────────────────────────────────────────────────────────
// ALL TEST RUNS
// ─────────────────────────────────────────────────────────────────────────────
function resetTests() {
  resetTestsSoft(false);
}
function resetTestsSoft(soft=false) {
  // If a previous page load is in-flight, cancel it so new filters apply immediately.
  abortFetchKey('tests');
  const s = _state.tests; s.page=1; s.done=false; s.loading = false;
  const tb = document.getElementById('tbody-tests');
  if (!soft) tb.innerHTML = `<tr class="empty-row"><td colspan="6">${esc(t('dash.table_loading'))}</td></tr>`;
  loadTests();
}
function clearTestFilters() {
  document.getElementById('f-tstatus').value = '';
  document.getElementById('f-tsource').value = 'real';
  document.getElementById('f-tname').value   = '';
  document.getElementById('f-tsuite').value  = '';
  _testsHours = 0;
  ['tf-t-6h','tf-t-24h','tf-t-7d'].forEach((id) => document.getElementById(id)?.classList.remove('active'));
  try { localStorage.setItem('cimon-tests-hours', '0'); } catch {}
  // Persist cleared values so F5 does not restore previous test filters from localStorage.
  try { _persistFiltersFromForm(); } catch { _syncURLAndFilterSummary(); }
  updateTestsExportLinks();
  resetTests();
}

function updateTestsExportLinks() {
  const src = document.getElementById('f-tsource')?.value || '';
  const a1 = document.getElementById('exp-tests-csv');
  const a2 = document.getElementById('exp-tests-xlsx');
  const a3 = document.getElementById('exp-tests-failed-csv');
  if (a1) a1.href = `api/export/tests?fmt=csv${src ? '&source=' + encodeURIComponent(src) : ''}`;
  if (a2) a2.href = `api/export/tests?fmt=xlsx${src ? '&source=' + encodeURIComponent(src) : ''}`;
  if (a3) a3.href = `api/export/tests?fmt=csv&status=failed${src ? '&source=' + encodeURIComponent(src) : ''}`;
}

function updateFailuresExportLinks() {
  const src = document.getElementById('f-fsource')?.value || document.getElementById('f-tsource')?.value || '';
  const d = _failuresDays > 0 ? `&days=${_failuresDays}` : '';
  const q = (extra) => `api/export/failures?fmt=${extra}&n=500${src ? '&source=' + encodeURIComponent(src) : ''}${d}`;
  const c = document.getElementById('exp-failures-csv');
  const x = document.getElementById('exp-failures-xlsx');
  if (c) c.href = q('csv');
  if (x) x.href = q('xlsx');
}

function toggleFailuresDayFilter(days) {
  const n = parseInt(String(days), 10) || 0;
  const wasOn = _failuresDays === n;
  _failuresDays = wasOn ? 0 : n;
  ['tf-f-1d','tf-f-3d','tf-f-7d','tf-f-30d'].forEach((id) => document.getElementById(id)?.classList.remove('active'));
  if (!wasOn && n > 0) {
    const map = { 1: 'tf-f-1d', 3: 'tf-f-3d', 7: 'tf-f-7d', 30: 'tf-f-30d' };
    document.getElementById(map[n])?.classList.add('active');
  }
  try { localStorage.setItem('cimon-failures-days', String(_failuresDays)); } catch { /* ignore */ }
  updateFailuresExportLinks();
  updateFilterSummary();
  resetFailures();
}

async function loadTests() {
  const s = _state.tests;
  if (s.loading || s.done) return;
  s.loading = true;

  _syncTestSourceQuickButtons();
  const status = document.getElementById('f-tstatus').value;
  const source = document.getElementById('f-tsource').value;
  const name   = document.getElementById('f-tname').value;
  const suite  = document.getElementById('f-tsuite').value;
  const url = apiUrl(`api/tests?page=${s.page}&per_page=${s.per_page}&status=${encodeURIComponent(status)}&source=${encodeURIComponent(source)}&name=${encodeURIComponent(name)}&suite=${encodeURIComponent(suite)}&hours=${_testsHours}`);

  const res = await fetchKeyed('tests', url).catch(()=>null);
  s.loading = false;

  const tbody = document.getElementById('tbody-tests');
  if (res === FETCH_ABORTED) return;
  if (!res || !res.ok) {
    if (res && res.status === 404) { tbody.innerHTML = `<tr class="empty-row"><td colspan="6">${esc(t('dash.table_no_test_data'))}${emptyStateActionsHtml()}</td></tr>`; }
    else {
      const detail = await fetchApiErrorDetail(res);
      srAnnounce(t('dash.table_api_err') + (detail ? ': ' + detail : ''), 'assertive');
      const extra = detail ? ` — ${esc(detail)}` : '';
      tbody.innerHTML = `<tr class="empty-row"><td colspan="6">${esc(t('dash.table_api_err'))}${extra}<br/><span class="err-hint">${esc(t('err.hint_retry'))}</span> <button type="button" class="btn btn-ghost" onclick="refreshAll()">${esc(t('common.retry'))}</button></td></tr>`;
    }
    s.done = true; updateFilterSummary(); _applyGlobalSearch(); return;
  }
  const data = await res.json();
  s.total = data.total;
  document.getElementById('tests-count').textContent = data.total;
  if (data.breakdown) {
    const b = data.breakdown;
    const el = document.getElementById('tests-breakdown');
    if (el) el.textContent = `Real: ${b.real_total || 0} (${b.real_failed || 0} failed) · Synthetic: ${b.synthetic_total || 0} (${b.synthetic_failed || 0} failed)`;
  }

  const rows = data.items;
  if (s.page === 1 && !rows.length) {
    if (_dashIsCollecting && tbody && tbody.querySelector('tr:not(.empty-row)')) {
      s.done = true;
      updateFilterSummary();
      _applyGlobalSearch();
      return;
    }
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6"><div>${esc(t('dash.table_no_tests'))}</div><div class="empty-hint">${t('dash.empty_tests_hint')}</div>${emptyStateActionsHtml()}</td></tr>`;
    s.done = true; updateFilterSummary(); _applyGlobalSearch(); return;
  }

  const mkSrcBadge = (src) => {
    const s = String(src || '').toLowerCase();
    const span = document.createElement('span');
    span.className = 'b';
    span.style.fontSize = '.66rem';
    if (s === 'jenkins_allure') { span.className = 'b b-green'; span.title = 'Allure'; span.textContent = 'ALLURE'; return span; }
    if (s === 'jenkins_console') { span.className = 'b b-purple'; span.title = 'Console'; span.textContent = 'CONSOLE'; return span; }
    if (s === 'jenkins_build') { span.className = 'b b-yellow'; span.title = 'Synthetic (job as test)'; span.textContent = 'JOB'; return span; }
    span.title = s;
    span.textContent = s ? s.slice(0, 10) : '';
    return span;
  };
  const frag = document.createDocumentFragment();
  rows.forEach((row) => {
    const tr = document.createElement('tr');

    const td0 = document.createElement('td');
    td0.style.maxWidth = '260px';
    td0.style.wordBreak = 'break-word';
    td0.title = String(row.test_name || '');
    const stack = document.createElement('div');
    stack.className = 'cell-stack';
    if (row.source) {
      stack.appendChild(mkSrcBadge(row.source));
    }
    const nameSpan = document.createElement('span');
    nameSpan.className = 'cell-main';
    nameSpan.textContent = String(row.test_name || '');
    stack.appendChild(nameSpan);
    td0.appendChild(stack);

    const td1 = document.createElement('td');
    td1.style.maxWidth = '160px';
    td1.style.color = 'var(--muted)';
    td1.style.fontSize = '.78rem';
    td1.title = String(row.suite || '');
    td1.textContent = String(row.suite || '');

    const td2 = document.createElement('td');
    td2.innerHTML = badge(row.status); // badge() returns trusted fixed HTML

    const td3 = document.createElement('td');
    td3.style.whiteSpace = 'nowrap';
    td3.textContent = dur(row.duration_seconds);

    const td4 = document.createElement('td');
    td4.style.whiteSpace = 'nowrap';
    td4.style.fontSize = '.78rem';
    td4.textContent = fmt(row.timestamp);

    const td5 = document.createElement('td');
    td5.className = 'col-compact-hide';
    td5.style.maxWidth = '360px';
    td5.style.wordBreak = 'break-word';
    td5.style.fontSize = '.78rem';
    td5.style.color = 'var(--muted)';
    td5.title = String(row.failure_message || '');
    td5.textContent = String(row.failure_message || '');

    tr.append(td0, td1, td2, td3, td4, td5);
    frag.appendChild(tr);
  });
  if (s.page === 1) tbody.replaceChildren(frag);
  else tbody.appendChild(frag);

  _applyGlobalSearch();
  updateFilterSummary();
  if (!data.has_more) { s.done = true; return; }
  s.page++;
}
