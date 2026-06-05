// Source / instance filter dropdown population
const _BUILD_PIPELINE_SOURCES = ['gitlab', 'github'];
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

function _renderInstanceOptions() {
  const sel = document.getElementById('f-instance');
  if (!sel) return;
  const src = document.getElementById('f-source')?.value || '';
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
    try { localStorage.removeItem('cimon-f-instance'); } catch { /* ignore */ }
  }
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
  resetBuilds();
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
  resetBuilds();
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
  _pruneInvalidBuildInstanceFilter();
  try { _primeBuildsTableFromSession?.(); } catch { /* ignore */ }
  updateFilterSummary();
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
