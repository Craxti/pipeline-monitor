// Source / instance filter dropdown population
const _BUILD_PIPELINE_SOURCES = ['gitlab', 'github'];
const _TEST_CI_SOURCES = ['jenkins', 'gitlab', 'github'];
let _allInstances = [];

function _pickBuildSourceValue(want) {
  const w = String(want || '').toLowerCase();
  if (w === 'jenkins') return 'jenkins';
  if (_BUILD_PIPELINE_SOURCES.includes(w)) return w;
  return _BUILD_PIPELINE_SOURCES[0];
}

function _defaultBuildSourceValue() {
  const sel = document.getElementById('f-source');
  if (!sel) return 'gitlab';
  return _pickBuildSourceValue(sel.value);
}

function _sourceOptionLabel(src) {
  const s = String(src || '').toLowerCase();
  if (s === 'jenkins') return 'Jenkins';
  if (s === 'gitlab') return 'GitLab';
  if (s === 'github') return 'GitHub';
  return String(src || '');
}

function _pickTestSourceValue(want) {
  const w = String(want || '').trim().toLowerCase();
  if (w === 'jenkins' || w.startsWith('jenkins')) return 'jenkins';
  if (w === 'gitlab' || w.startsWith('gitlab')) return 'gitlab';
  if (w === 'github' || w.startsWith('github')) return 'github';
  if (w === 'real' || w === 'synthetic' || w === 'pipelines' || w === 'gitlab_test') return 'jenkins';
  return _TEST_CI_SOURCES[0];
}

function _renderScopedInstanceOptions(instanceSelId, sourceValue, lsKey) {
  const sel = document.getElementById(instanceSelId);
  if (!sel) return;
  const src = _pickTestSourceValue(sourceValue);
  const cur = sel.value;
  sel.innerHTML = `<option value="">${esc(t('dash.opt_all_instances') || 'All instances')}</option>`;
  (_allInstances || []).forEach((it) => {
    const name = (it && it.name) ? String(it.name) : '';
    const kind = (it && it.source) ? String(it.source) : '';
    if (!name) return;
    if (src && kind && kind !== src) return;
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    if (kind) opt.dataset.source = kind;
    sel.appendChild(opt);
  });
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
  else if (cur) {
    sel.value = '';
    if (lsKey) {
      try { localStorage.removeItem('cimon-f-' + lsKey); } catch { /* ignore */ }
    }
  }
}

function _renderInstanceOptions() {
  _renderScopedInstanceOptions('f-instance', document.getElementById('f-source')?.value || '', 'instance');
}

function _renderAllTestInstanceOptions() {
  _renderScopedInstanceOptions('f-tinstance', document.getElementById('f-tsource')?.value || '', 'tinstance');
  _renderScopedInstanceOptions('f-finstance', document.getElementById('f-fsource')?.value || '', 'finstance');
}

function _normalizeTestSourceSelects() {
  const tsel = document.getElementById('f-tsource');
  if (tsel) tsel.value = _pickTestSourceValue(tsel.value);
  const fsel = document.getElementById('f-fsource');
  if (fsel) fsel.value = _pickTestSourceValue(fsel.value);
}

function _pruneInvalidTestInstanceFilter(selId, lsKey) {
  const sel = document.getElementById(selId);
  if (!sel || !sel.value) return;
  if ([...sel.options].some((o) => o.value === sel.value)) return;
  sel.value = '';
  if (lsKey) {
    try { localStorage.removeItem('cimon-f-' + lsKey); } catch { /* ignore */ }
  }
  _writeURLFilters();
}

function _onTestSourceFilterChange(which) {
  _normalizeTestSourceSelects();
  _renderAllTestInstanceOptions();
  if (which === 'runs') {
    _pruneInvalidTestInstanceFilter('f-tinstance', 'tinstance');
    try { _persistFiltersFromForm(); } catch { /* ignore */ }
    updateTestsExportLinks();
    resetTests();
    return;
  }
  _pruneInvalidTestInstanceFilter('f-finstance', 'finstance');
  try { _persistFiltersFromForm(); } catch { /* ignore */ }
  updateFailuresExportLinks();
  resetFailures(false, true);
}

function _onTestInstanceFilterChange(which) {
  const instSel = document.getElementById(which === 'runs' ? 'f-tinstance' : 'f-finstance');
  const srcSel = document.getElementById(which === 'runs' ? 'f-tsource' : 'f-fsource');
  if (instSel?.value && srcSel) {
    const hit = (_allInstances || []).find((it) => String(it?.name || '') === instSel.value);
    if (hit?.source) srcSel.value = _pickTestSourceValue(hit.source);
    _renderAllTestInstanceOptions();
    if (![...instSel.options].some((o) => o.value === instSel.value)) instSel.value = '';
  }
  _pruneInvalidTestInstanceFilter(which === 'runs' ? 'f-tinstance' : 'f-finstance', which === 'runs' ? 'tinstance' : 'finstance');
  try { _persistFiltersFromForm(); } catch { /* ignore */ }
  if (which === 'runs') resetTests();
  else resetFailures(false, true);
}

async function populateSources() {
  const sel = document.getElementById('f-source');
  if (!sel) return;
  sel.value = _pickBuildSourceValue(sel.value);
  updateFilterSummary();
}

async function populateInstances() {
  const res = await fetch(apiUrl('api/instances')).catch(()=>null);
  if (!res || !res.ok) return;
  _allInstances = await res.json();
  _renderInstanceOptions();
}

function _onBuildSourceFilterChange() {
  _renderInstanceOptions();
  _pruneInvalidBuildInstanceFilter();
  try { _persistFiltersFromForm(); } catch { /* ignore */ }
  resetBuilds(false, true);
}

function _onBuildInstanceFilterChange() {
  const sel = document.getElementById('f-instance');
  const srcSel = document.getElementById('f-source');
  if (sel?.value && srcSel) {
    const hit = (_allInstances || []).find((it) => String(it?.name || '') === sel.value);
    if (hit?.source) srcSel.value = String(hit.source);
    _renderInstanceOptions();
    if (![...sel.options].some((o) => o.value === sel.value)) sel.value = '';
  }
  _pruneInvalidBuildInstanceFilter();
  try { _persistFiltersFromForm(); } catch { /* ignore */ }
  resetBuilds(false, true);
}

let _populateSourcesPromise = null;

async function _populateSourcesAndInstancesInner() {
  await populateInstances();
  await populateSources();
  _renderInstanceOptions();
  _readURLFilters();
  _maybeRestoreFiltersFromLS();
  const srcSel = document.getElementById('f-source');
  if (srcSel) srcSel.value = _pickBuildSourceValue(srcSel.value);
  _normalizeTestSourceSelects();
  _renderAllTestInstanceOptions();
  _pruneInvalidBuildInstanceFilter();
  _pruneInvalidTestInstanceFilter('f-tinstance', 'tinstance');
  _pruneInvalidTestInstanceFilter('f-finstance', 'finstance');
  try { _primeBuildsTableFromSession?.(); } catch { /* ignore */ }
  updateFilterSummary();
  if (typeof refreshAllModernSelects === 'function') refreshAllModernSelects();
}

async function populateSourcesAndInstances() {
  if (_populateSourcesPromise) return _populateSourcesPromise;
  _populateSourcesPromise = _populateSourcesAndInstancesInner().finally(() => {
    _populateSourcesPromise = null;
  });
  return _populateSourcesPromise;
}

function _pruneInvalidBuildInstanceFilter() {
  const sel = document.getElementById('f-instance');
  if (!sel || !sel.value) return;
  if ([...sel.options].some((o) => o.value === sel.value)) return;
  sel.value = '';
  try { localStorage.removeItem('cimon-f-instance'); } catch { /* ignore */ }
  _writeURLFilters();
}
