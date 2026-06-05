// Builds table (reset / load / filters): dashboard.builds.js
// Load after dashboard.build-log-cells.js, before dashboard.failures.js.

let _buildSort = { key: 'started', dir: 'desc' };
let _buildSortInit = false;

const _BUILD_SORT_MAP = [[0, 'status'], [1, 'job'], [2, 'instance'], [3, 'num'], [4, 'duration'], [5, 'started']];

function _buildSortVal(row, key) {
  if (key === 'instance') return String(row.instance || row.source || '').toLowerCase();
  if (key === 'job') return String(row.job_name || '').toLowerCase();
  if (key === 'num') return Number(row.build_number || 0);
  if (key === 'status') return String(row.status_normalized || row.status || '').toLowerCase();
  if (key === 'duration') return Number(row.duration_seconds || 0);
  return String(row.started_at || '');
}

function _cmpBuildRows(a, b, key, dir) {
  const d = dir === 'asc' ? 1 : -1;
  const va = _buildSortVal(a, key);
  const vb = _buildSortVal(b, key);
  if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * d;
  return String(va).localeCompare(String(vb)) * d;
}

function _sortBuildRows(rows) {
  const items = [...rows];
  items.sort((a, b) => _cmpBuildRows(a, b, _buildSort.key, _buildSort.dir));
  return items;
}

function _updateBuildSortHdr() {
  const row = document.querySelector('#panel-builds thead tr.th-cols');
  if (!row) return;
  const ths = row.querySelectorAll('th');
  _BUILD_SORT_MAP.forEach(([idx, key]) => {
    const th = ths[idx];
    if (!th) return;
    const base = String(th.getAttribute('data-sort-label') || th.textContent || '').trim();
    if (!th.getAttribute('data-sort-label')) th.setAttribute('data-sort-label', base);
    const arrow = _buildSort.key === key ? (_buildSort.dir === 'asc' ? ' ↑' : ' ↓') : '';
    th.textContent = base + arrow;
  });
}

function _initBuildSort() {
  if (_buildSortInit) return;
  const row = document.querySelector('#panel-builds thead tr.th-cols');
  if (!row) return;
  const ths = row.querySelectorAll('th');
  _BUILD_SORT_MAP.forEach(([idx, key]) => {
    const th = ths[idx];
    if (!th) return;
    th.style.cursor = 'pointer';
    th.title = 'Sort';
    th.addEventListener('click', () => {
      if (_buildSort.key === key) _buildSort.dir = _buildSort.dir === 'asc' ? 'desc' : 'asc';
      else { _buildSort.key = key; _buildSort.dir = (key === 'num' || key === 'duration' || key === 'started') ? 'desc' : 'asc'; }
      _updateBuildSortHdr();
      resetBuilds();
    });
  });
  _buildSortInit = true;
  _updateBuildSortHdr();
}

function resetBuilds(soft=false, force=false) {
  const s = _state.builds; s.page=1; s.done=false;
  try { abortFetchKey('builds'); } catch { /* ignore */ }
  s.loading = false;
  if (force || !soft) _lastBuildsPageSig = '';
  const tb = document.getElementById('tbody-builds');
  if (!soft && tb) {
    tb.innerHTML = `<tr class="empty-row"><td colspan="${BUILDS_TBL_COLS}">${esc(t('dash.table_loading'))}</td></tr>`;
  }
  loadBuilds();
}

function clearBuildFilters() {
  document.getElementById('f-source').value  = _defaultBuildSourceValue();
  document.getElementById('f-instance').value = '';
  document.getElementById('f-bstatus').value = '';
  document.getElementById('f-job').value     = '';
  _buildsHours = 0;
  document.querySelectorAll('.time-filter-btn').forEach(b => b.classList.remove('active'));
  try { localStorage.setItem('cimon-builds-hours', '0'); } catch { /* ignore */ }
  try { _persistFiltersFromForm(); } catch { /* ignore */ }
  _renderInstanceOptions?.();
  resetBuilds();
}

function filterBuilds(source, status, job, instance) {
  document.getElementById('f-source').value  = _pickBuildSourceValue(source);
  document.getElementById('f-instance').value = instance || '';
  document.getElementById('f-bstatus').value = status || '';
  document.getElementById('f-job').value     = job    || '';
  try { _persistFiltersFromForm(); } catch { /* ignore */ }
  _renderInstanceOptions?.();
  resetBuilds();
  goToInTab('builds', 'panel-builds');
}

async function loadBuilds() {
  _initBuildSort();
  const s = _state.builds;
  if (s.loading || s.done) return;
  s.loading = true;
  try {
    const source  = document.getElementById('f-source').value;
    const inst    = document.getElementById('f-instance').value;
    const status  = document.getElementById('f-bstatus').value;
    const job     = document.getElementById('f-job').value;
    const url = apiUrl(`api/builds?page=${s.page}&per_page=${s.per_page}&source=${encodeURIComponent(source)}&instance=${encodeURIComponent(inst)}&status=${encodeURIComponent(status)}&job=${encodeURIComponent(job)}&hours=${_buildsHours}`);

    const res = await fetchKeyed('builds', url).catch(()=>null);
    const tbody = document.getElementById('tbody-builds');
    if (res === FETCH_ABORTED) return;
    if (!res || !res.ok) {
      const detail = await fetchApiErrorDetail(res);
      srAnnounce(t('dash.table_api_err') + (detail ? ': ' + detail : ''), 'assertive');
      const extra = detail ? ` — ${esc(detail)}` : '';
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${BUILDS_TBL_COLS}">${esc(t('dash.table_api_err'))}${extra}<br/><span class="err-hint">${esc(t('err.hint_retry'))}</span> <button type="button" class="btn btn-ghost" onclick="refreshAll()">${esc(t('common.retry'))}</button></td></tr>`;
      _applyGlobalSearch();
      return;
    }
    const data = await res.json();
    s.total = data.total;
    document.getElementById('builds-count').textContent = data.total;

    const rows = data.items;
    if (s.page === 1 && !rows.length) {
      if (keepTableOnTransientEmpty(tbody, rows, s, 'builds')) return;
      const instF = document.getElementById('f-instance')?.value || '';
      const srcF = document.getElementById('f-source')?.value || '';
      let extraHint = '';
      if (instF) extraHint = `<div class="empty-hint">${esc(tf('dash.empty_builds_instance', { name: instF }))}</div>`;
      else if (srcF === 'gitlab') extraHint = `<div class="empty-hint">${esc(t('dash.empty_builds_gitlab'))}</div>`;
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${BUILDS_TBL_COLS}"><div>${esc(t('dash.table_no_builds'))}</div>${extraHint || `<div class="empty-hint">${t('dash.empty_builds_hint')}</div>`}${emptyStateActionsHtml()}</td></tr>`;
      s.done = true; updateFilterSummary(); _applyGlobalSearch(); return;
    }

    const favKeys = _loadFavKeys();
    const _buildsRowSig = (b) => [
      String(b.source || '').trim().toLowerCase(),
      String(b.instance || '').trim().toLowerCase(),
      String(b.job_name ?? ''),
      String(b.build_number ?? ''),
      String(b.status_normalized || b.status || ''),
      String(b.duration_seconds ?? ''),
      String(b.started_at || ''),
    ].join('\x1f');
    const sorted = _sortBuildRows(rows || []);
    const html = sorted.map((b) => _buildMockupRow(b, { favKeys })).join('');

    if (s.page === 1) {
      const pageSig = sorted.map(_buildsRowSig).join('\x1e');
      if (_liveMode && pageSig && pageSig === _lastBuildsPageSig) {
        updateFilterSummary();
        _applyGlobalSearch();
        if (!data.has_more) { s.done = true; return; }
        s.page++;
        window.requestAnimationFrame(() => { loadBuilds(); });
        return;
      }
      _lastBuildsPageSig = pageSig;
      swapTableContentSmooth(tbody, () => {
        tbody.innerHTML = html;
        try { cacheStaleTableHtml('builds', tbody); } catch { /* ignore */ }
      });
    } else tbody.insertAdjacentHTML('beforeend', html);

    _applyGlobalSearch();
    updateFilterSummary();
    if (!data.has_more) { s.done = true; return; }
    s.page++;
    window.requestAnimationFrame(() => { loadBuilds(); });
  } finally {
    s.loading = false;
  }
}
