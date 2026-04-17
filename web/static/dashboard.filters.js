// Deep links + URL filter sync + updateFilterSummary (split from dashboard.js).
// Load after dashboard.actions.js (_buildsHours/_testsHours/_failuresDays), before dashboard.sources.js.

// ─────────────────────────────────────────────────────────────────────────────
// Deep links — sync URL query params ↔ filter inputs
// ─────────────────────────────────────────────────────────────────────────────
const _FILTER_PARAMS = [
  { id:'f-source', key:'source' },
  { id:'f-instance', key:'instance' },
  { id:'f-bstatus', key:'status' },
  { id:'f-job',    key:'job' },
  { id:'f-tstatus',key:'tstatus' },
  { id:'f-tname',  key:'tname' },
  { id:'f-tsuite', key:'tsuite' },
  { id:'f-fname',  key:'fname' },
  { id:'f-fsuite', key:'fsuite' },
  { id:'f-svstatus', key:'svstatus' },
];

function updateFilterSummary() {
  const fb = [];
  const fs = document.getElementById('f-source');
  const fi = document.getElementById('f-instance');
  const st = document.getElementById('f-bstatus');
  const fj = document.getElementById('f-job');
  if (fs && fs.value) fb.push(`${t('dash.th_source')}: ${fs.value}`);
  if (fi && fi.value) fb.push(`Instance: ${fi.value}`);
  if (st && st.value) fb.push(`${t('dash.th_status')}: ${st.value}`);
  if (fj && fj.value) fb.push(`${t('dash.th_job')}: ${fj.value}`);
  if (_buildsHours === 24) fb.push('24h');
  if (_buildsHours === 168) fb.push('7d');
  const elb = document.getElementById('filter-active-builds');
  const elbTxt = document.getElementById('filter-active-builds-txt');
  if (elb) {
    if (fb.length) {
      elb.style.display = 'block';
      if (elbTxt) elbTxt.textContent = `${t('dash.active_filters')}: ${fb.join(' · ')}`;
    } else {
      elb.style.display = 'none';
      if (elbTxt) elbTxt.textContent = '';
    }
  }
  const ff = [];
  const fn = document.getElementById('f-fname');
  const fsu = document.getElementById('f-fsuite');
  if (fn && fn.value) ff.push(`${t('dash.th_test_name')}: ${fn.value}`);
  if (fsu && fsu.value) ff.push(`${t('dash.th_suite')}: ${fsu.value}`);
  if (_failuresDays > 0) ff.push(tf('dash.failures_last_days', { n: _failuresDays }));
  const elf = document.getElementById('filter-active-failures');
  if (elf) {
    if (ff.length) {
      elf.style.display = 'block';
      elf.textContent = `${t('dash.active_filters')}: ${ff.join(' · ')}`;
    } else {
      elf.style.display = 'none';
      elf.textContent = '';
    }
  }
  const ft = [];
  const fts = document.getElementById('f-tstatus');
  const ftn = document.getElementById('f-tname');
  const ftsuite = document.getElementById('f-tsuite');
  if (fts && fts.value) ft.push(`${t('dash.th_status')}: ${fts.value}`);
  if (ftn && ftn.value) ft.push(`${t('dash.filter_test_ph')}: ${ftn.value}`);
  if (ftsuite && ftsuite.value) ft.push(`${t('dash.th_suite')}: ${ftsuite.value}`);
  if (_testsHours === 6) ft.push('6h');
  if (_testsHours === 24) ft.push('24h');
  if (_testsHours === 168) ft.push('7d');
  const elt = document.getElementById('filter-active-tests');
  const eltTxt = document.getElementById('filter-active-tests-txt');
  if (elt) {
    if (ft.length) {
      elt.style.display = 'block';
      if (eltTxt) eltTxt.textContent = `${t('dash.active_filters')}: ${ft.join(' · ')}`;
    } else {
      elt.style.display = 'none';
      if (eltTxt) eltTxt.textContent = '';
    }
  }
  const fsv = document.getElementById('f-svstatus');
  const svParts = [];
  if (fsv && fsv.value) svParts.push(`${t('dash.th_status')}: ${fsv.value}`);
  const elsv = document.getElementById('filter-active-svcs');
  const elsvTxt = document.getElementById('filter-active-svcs-txt');
  if (elsv) {
    if (svParts.length) {
      elsv.style.display = 'block';
      if (elsvTxt) elsvTxt.textContent = `${t('dash.active_filters')}: ${svParts.join(' · ')}`;
    } else {
      elsv.style.display = 'none';
      if (elsvTxt) elsvTxt.textContent = '';
    }
  }
}

function _persistFiltersFromForm() {
  _FILTER_PARAMS.forEach(({ id, key }) => {
    const el = document.getElementById(id);
    if (el) localStorage.setItem('cimon-f-' + key, el.value);
  });
  _writeURLFilters();
  updateFilterSummary();
}

function _maybeRestoreFiltersFromLS() {
  const p = new URLSearchParams(location.search);
  _FILTER_PARAMS.forEach(({ id, key }) => {
    if (p.has(key)) return;
    const v = localStorage.getItem('cimon-f-' + key);
    const el = document.getElementById(id);
    if (el && v != null && v !== '') el.value = v;
  });
  const bh = localStorage.getItem('cimon-builds-hours');
  if (bh && !p.has('hours')) {
    const h = parseInt(bh, 10);
    if (h === 24 || h === 168) {
      _buildsHours = h;
      document.querySelectorAll('.time-filter-btn').forEach(b => b.classList.remove('active'));
      const id = h === 24 ? 'tf-24h' : 'tf-7d';
      document.getElementById(id)?.classList.add('active');
    }
  }
}

function _readURLFilters() {
  const p = new URLSearchParams(location.search);
  _FILTER_PARAMS.forEach(({id, key}) => {
    const el = document.getElementById(id);
    if (el && p.has(key)) el.value = p.get(key);
  });
}

function _writeURLFilters() {
  const p = new URLSearchParams();
  _FILTER_PARAMS.forEach(({id, key}) => {
    const el = document.getElementById(id);
    if (el && el.value) p.set(key, el.value);
  });
  if (_dashTab && _dashTab !== 'overview') p.set('tab', _dashTab);
  const str = p.toString();
  const h = location.hash || '';
  history.replaceState(null, '', (str ? location.pathname + '?' + str : location.pathname) + h);
}

function _hookFilterURLSync() {
  _FILTER_PARAMS.forEach(({ id }) => {
    const el = document.getElementById(id);
    if (!el) return;
    const evt = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evt, _persistFiltersFromForm);
  });
}
