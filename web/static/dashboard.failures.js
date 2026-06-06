// Top failures panel (aggregated): dashboard.failures.js
// Load after dashboard.builds.js, before the rest of dashboard.js.

// ─────────────────────────────────────────────────────────────────────────────
// FAILURES (top-N aggregated)
// ─────────────────────────────────────────────────────────────────────────────
const TOP_FAILURES_AGG_LIMIT = 10000;

let _failSort = { key: 'count', dir: 'desc' };
let _failSortInit = false;
let _failuresLoadGen = 0;
let _lastFailuresPageSig = '';

function _failSortVal(row, key) {
  if (key === 'test') return String(row.test_name || '').toLowerCase();
  if (key === 'suite') return String(row.suite || '').toLowerCase();
  if (key === 'count') return Number(row.count || 0);
  return String(row.message || '').toLowerCase();
}

function _sortFailureRows(rows) {
  const items = [...rows];
  const k = _failSort.key;
  const d = _failSort.dir === 'asc' ? 1 : -1;
  items.sort((a, b) => {
    const va = _failSortVal(a, k);
    const vb = _failSortVal(b, k);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * d;
    return String(va).localeCompare(String(vb)) * d;
  });
  return items;
}

function _updateFailureSortHdr() {
  const row = document.querySelector('#panel-failures thead tr.th-cols');
  if (!row) return;
  const ths = row.querySelectorAll('th');
  const map = [[1, 'test'], [2, 'suite'], [3, 'count'], [4, 'message']];
  map.forEach(([idx, key]) => {
    const th = ths[idx];
    if (!th) return;
    const base = String(th.getAttribute('data-sort-label') || th.textContent || '').trim();
    if (!th.getAttribute('data-sort-label')) th.setAttribute('data-sort-label', base);
    const arrow = _failSort.key === key ? (_failSort.dir === 'asc' ? ' ↑' : ' ↓') : '';
    th.textContent = base + arrow;
  });
}

function _initFailureSort() {
  if (_failSortInit) return;
  const row = document.querySelector('#panel-failures thead tr.th-cols');
  if (!row) return;
  const ths = row.querySelectorAll('th');
  const map = [[1, 'test'], [2, 'suite'], [3, 'count'], [4, 'message']];
  map.forEach(([idx, key]) => {
    const th = ths[idx];
    if (!th) return;
    th.style.cursor = 'pointer';
    th.title = 'Sort';
    th.addEventListener('click', () => {
      if (_failSort.key === key) _failSort.dir = _failSort.dir === 'asc' ? 'desc' : 'asc';
      else { _failSort.key = key; _failSort.dir = (key === 'count') ? 'desc' : 'asc'; }
      _updateFailureSortHdr();
      resetFailures();
    });
  });
  _failSortInit = true;
  _updateFailureSortHdr();
}

function _appendFailureRows(tbody, rows, page, replace) {
  const offset = (page - 1) * _state.failures.per_page;
  const frag = document.createDocumentFragment();
  rows.forEach((f, i) => {
    const tr = document.createElement('tr');

    const td0 = document.createElement('td');
    td0.className = 'mono c-fail';
    td0.style.fontWeight = '700';
    td0.textContent = String(offset + i + 1);

    const td1 = document.createElement('td');
    td1.style.maxWidth = '280px';
    td1.style.wordBreak = 'break-word';
    td1.title = String(f.test_name || '');
    if (f.source) {
      const b = document.createElement('span');
      b.className = 'b b-purple';
      b.style.fontSize = '.66rem';
      b.textContent = String(f.source).replace('jenkins_', '').toUpperCase().slice(0, 8);
      td1.appendChild(b);
      td1.appendChild(document.createTextNode(' '));
    }
    if (f.source_instance) {
      const bi = document.createElement('span');
      bi.className = 'b b-dim';
      bi.style.fontSize = '.66rem';
      bi.textContent = String(f.source_instance).slice(0, 24);
      td1.appendChild(bi);
      td1.appendChild(document.createTextNode(' '));
    }
    td1.appendChild(document.createTextNode(String(f.test_name || '')));
    try {
      if (typeof window.buildAllureActionButtonsFragment === 'function') {
        const afr = window.buildAllureActionButtonsFragment(f);
        if (afr) {
          const aw = document.createElement('div');
          aw.style.marginTop = '.28rem';
          aw.appendChild(afr);
          td1.appendChild(aw);
        }
      }
    } catch { /* ignore */ }

    const td2 = document.createElement('td');
    td2.style.maxWidth = '160px';
    td2.style.color = 'var(--muted)';
    td2.style.fontSize = '.78rem';
    td2.title = String(f.suite || '');
    td2.textContent = String(f.suite || '');

    const td3 = document.createElement('td');
    const strong = document.createElement('strong');
    strong.className = 'c-fail';
    strong.textContent = String(f.count ?? '');
    td3.appendChild(strong);

    const td4 = document.createElement('td');
    td4.style.maxWidth = '360px';
    td4.style.wordBreak = 'break-word';
    td4.style.fontSize = '.78rem';
    td4.style.color = 'var(--muted)';
    td4.title = String(f.message || '');
    td4.textContent = String(f.message || '');

    tr.append(td0, td1, td2, td3, td4);
    frag.appendChild(tr);
  });
  if (replace) swapTableContentSmooth(tbody, () => { tbody.replaceChildren(frag); });
  else tbody.appendChild(frag);
}

function resetFailures(soft=false) {
  // Cancel any in-flight multi-page load before restarting.
  _failuresLoadGen++;
  abortFetchKey('failures');
  const s = _state.failures; s.page=1; s.done=false; s.loading = false;
  const tb = document.getElementById('tbody-failures');
  // During collect, keep visible rows unless the user explicitly forced a hard reset.
  if (!soft && typeof _collectGraceActive === 'function' && _collectGraceActive() && tbodyHasDataRows(tb)) {
    soft = true;
  }
  if (!soft && tb) tb.innerHTML = `<tr class="empty-row"><td colspan="5">${esc(t('dash.table_loading'))}</td></tr>`;
  loadFailures();
}
function clearFailureFilters() {
  const fs = document.getElementById('f-fsource');
  if (fs) fs.value = 'real';
  document.getElementById('f-fname').value  = '';
  document.getElementById('f-fsuite').value = '';
  _failuresDays = 0;
  ['tf-f-1d','tf-f-3d','tf-f-7d','tf-f-30d'].forEach((id) => document.getElementById(id)?.classList.remove('active'));
  try { localStorage.setItem('cimon-failures-days', '0'); } catch { /* ignore */ }
  try { _persistFiltersFromForm(); } catch { _syncURLAndFilterSummary(); }
  updateFailuresExportLinks();
  resetFailures();
}
// Called from stat cards
function filterTests(status) {
  document.getElementById('f-tstatus').value = status;
  try { _persistFiltersFromForm(); } catch { /* ignore */ }
  resetTests();
  goToInTab('test-runs', 'panel-tests');
}

async function loadFailures() {
  _initFailureSort();
  const s = _state.failures;
  if (s.loading || s.done) return;

  const tbody = document.getElementById('tbody-failures');
  if (guardPanelLoadDuringCollect('failures', tbody, s)) return;
  const incr = typeof isCollectIncrementalRefresh === 'function' && isCollectIncrementalRefresh();
  if (!incr && s.page === 1 && typeof shouldSkipTableReloadDuringCollect === 'function' && shouldSkipTableReloadDuringCollect('failures', tbody)) {
    s.done = true;
    s.loading = false;
    return;
  }

  const myGen = ++_failuresLoadGen;
  s.loading = true;
  const name  = document.getElementById('f-fname').value;
  const suite = document.getElementById('f-fsuite').value;
  const source = document.getElementById('f-fsource')?.value || document.getElementById('f-tsource')?.value || '';
  const dayQ = _failuresDays > 0 ? `&days=${_failuresDays}` : '';
  const perPage = incr && typeof collectIncrementalPerPage === 'function'
    ? collectIncrementalPerPage(s.per_page)
    : s.per_page;
  const aggLimit = incr ? 800 : TOP_FAILURES_AGG_LIMIT;

  try {
    while (myGen === _failuresLoadGen && !s.done) {
      const url = apiUrl(
        `api/tests/top-failures?page=${s.page}&per_page=${perPage}&n=${aggLimit}`
        + `&source=${encodeURIComponent(source)}&name=${encodeURIComponent(name)}&suite=${encodeURIComponent(suite)}${dayQ}`
      );

      const res = await fetchKeyed('failures', url).catch(() => null);
      if (myGen !== _failuresLoadGen) return;
      if (res === FETCH_ABORTED) return;
      if (!res || !res.ok) {
        if (keepTableOnTransientApiError(tbody, res, s, 'failures')) return;
        if (res && res.status === 404) {
          tbody.innerHTML = `<tr class="empty-row"><td colspan="5">${esc(t('dash.table_no_test_data'))}${emptyStateActionsHtml()}</td></tr>`;
        } else {
          const detail = await fetchApiErrorDetail(res);
          srAnnounce(t('dash.table_api_err') + (detail ? ': ' + detail : ''), 'assertive');
          const extra = detail ? ` — ${esc(detail)}` : '';
          tbody.innerHTML = `<tr class="empty-row"><td colspan="5">${esc(t('dash.table_api_err'))}${extra}<br/><span class="err-hint">${esc(t('err.hint_retry'))}</span> <button type="button" class="btn btn-ghost" onclick="refreshAll()">${esc(t('common.retry'))}</button></td></tr>`;
        }
        s.done = true;
        updateFilterSummary();
        _applyGlobalSearch();
        return;
      }

      const data = await res.json();
      if (myGen !== _failuresLoadGen) return;
      s.total = data.total;
      document.getElementById('failures-count').textContent = data.total;

      const rows = _sortFailureRows(data.items || []);
      if (s.page === 1 && !rows.length) {
        if (keepTableOnTransientEmpty(tbody, rows, s, 'failures')) return;
        tbody.innerHTML = `<tr class="empty-row"><td colspan="5"><div>${esc(t('dash.table_no_failures'))}</div><div class="empty-hint">${t('dash.empty_failures_hint')}</div>${emptyStateActionsHtml()}</td></tr>`;
        s.done = true;
        updateFilterSummary();
        _applyGlobalSearch();
        return;
      }

      if (s.page === 1 && !data.has_more) {
        const pageSig = rows.map((f) => [
          String(f.test_name || ''),
          String(f.suite || ''),
          String(f.count ?? ''),
          String(f.message || '').slice(0, 120),
        ].join('\x1f')).join('\x1e');
        if (_liveMode && pageSig && pageSig === _lastFailuresPageSig) {
          s.done = true;
          updateFilterSummary();
          _applyGlobalSearch();
          return;
        }
        _lastFailuresPageSig = pageSig;
      }

      _appendFailureRows(tbody, rows, s.page, s.page === 1);

      if (incr || !data.has_more) {
        s.done = true;
        break;
      }
      s.page++;
    }

    if (s.done && tbodyHasDataRows(tbody)) {
      try { cacheStaleTableHtml('failures', tbody); } catch { /* ignore */ }
    }
    _applyGlobalSearch();
    updateFilterSummary();
  } finally {
    if (myGen === _failuresLoadGen) s.loading = false;
  }
}
