// All test runs + export link helpers: dashboard.tests.js
// Load before dashboard.failures.js (shared Allure button builder on ``window``), before dashboard.services.js.

// ─────────────────────────────────────────────────────────────────────────────
// ALL TEST RUNS
// ─────────────────────────────────────────────────────────────────────────────
function _normalizeTestSourceUi(uiSource) {
  const s = String(uiSource || '').trim().toLowerCase();
  if (!s || s === 'pipelines' || s === 'gitlab_test') return 'real';
  return String(uiSource || '').trim() || 'real';
}

function _mapTestSourceForApi(uiSource) {
  return _normalizeTestSourceUi(uiSource);
}

function _migrateLegacyTestSourceSelect() {
  const sel = document.getElementById('f-tsource');
  if (!sel) return;
  const v = String(sel.value || '').trim().toLowerCase();
  if (v === 'pipelines' || v === 'gitlab_test') {
    sel.value = 'real';
    try { localStorage.setItem('cimon-f-tsource', 'real'); } catch { /* ignore */ }
  }
}

let _lastTestsPageSig = '';
let _testsLoadGen = 0;
let _expandedTestGroups = new Set();
let _testsSort = { key: 'timestamp', dir: 'desc' };
let _testsSortInit = false;

function _testsSortVal(row, key) {
  if (key === 'name') return String(row.test_name || '').toLowerCase();
  if (key === 'suite') return String(row.suite || '').toLowerCase();
  if (key === 'status') return String(row.status_normalized || row.status || '').toLowerCase();
  if (key === 'duration') return Number(row.duration_seconds || 0);
  return String(row.timestamp || '');
}

function _sortTestsRows(rows) {
  const items = [...rows];
  const k = _testsSort.key;
  const d = _testsSort.dir === 'asc' ? 1 : -1;
  items.sort((a, b) => {
    const va = _testsSortVal(a, k);
    const vb = _testsSortVal(b, k);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * d;
    return String(va).localeCompare(String(vb)) * d;
  });
  return items;
}

function _testGroupKey(row) {
  const inst = String(row.source_instance || '').trim();
  const src = String(row.source || '').trim().toLowerCase();
  const suite = String(row.suite || '').trim();
  const name = String(row.test_name || '').trim();
  return `${inst}\x1f${src}\x1f${suite}\x1f${name}`;
}

function _runTsMs(row) {
  const ts = row && row.timestamp;
  if (!ts) return 0;
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? d.getTime() : 0;
}

function _groupTestRuns(runs) {
  const map = new Map();
  (runs || []).forEach((r) => {
    const k = _testGroupKey(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  });
  const groups = [];
  map.forEach((recs, key) => {
    recs.sort((a, b) => _runTsMs(b) - _runTsMs(a));
    groups.push({ key, runs: recs, latest: recs[0] });
  });
  return groups;
}

function _sortTestGroups(groups) {
  const items = [...groups];
  const k = _testsSort.key;
  const d = _testsSort.dir === 'asc' ? 1 : -1;
  items.sort((a, b) => {
    const va = _testsSortVal(a.latest, k);
    const vb = _testsSortVal(b.latest, k);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * d;
    return String(va).localeCompare(String(vb)) * d;
  });
  return items;
}

function toggleTestGroup(encKey) {
  const k = decodeURIComponent(String(encKey || ''));
  if (!k) return;
  if (_expandedTestGroups.has(k)) _expandedTestGroups.delete(k);
  else _expandedTestGroups.add(k);
  applyTestGroupVisibility(encKey);
}

function applyTestGroupVisibility(encKey) {
  const tbody = document.getElementById('tbody-tests');
  if (!tbody) return;
  const k = decodeURIComponent(String(encKey || ''));
  const expanded = _expandedTestGroups.has(k);
  tbody.querySelectorAll('tr.test-run-child').forEach((tr) => {
    if (tr.getAttribute('data-tgroup') !== String(encKey || '')) return;
    tr.style.display = expanded ? '' : 'none';
  });
  tbody.querySelectorAll('tr.test-group-row').forEach((tr) => {
    if (tr.getAttribute('data-tgroup') !== String(encKey || '')) return;
    const btn = tr.querySelector('.test-grp-toggle');
    if (btn) btn.textContent = expanded ? '−' : '+';
    tr.classList.toggle('is-expanded', expanded);
  });
}

function _testRunBuildContext(run, parentRow) {
  const parent = parentRow || run;
  return {
    source: run.source || parent.source,
    source_instance: run.source_instance || parent.source_instance,
    suite: run.suite || parent.suite,
    build_number: run.build_number,
    url: run.url,
  };
}

async function _openBuildFromTestRun(run, parentRow) {
  const ctx = _testRunBuildContext(run, parentRow);
  const direct = String(ctx.url || '').trim();
  if (direct) {
    window.open(safeUrl(direct), '_blank', 'noopener');
    return;
  }
  const url = await _resolveBuildUrlForTest(ctx);
  if (url) {
    window.open(safeUrl(url), '_blank', 'noopener');
    return;
  }
  _openInternalBuildFromTest(ctx);
}

function _appendRunBuildLink(cell, run, parentRow) {
  const prefix = document.createElement('span');
  prefix.textContent = '↳ ';
  cell.appendChild(prefix);
  const bn = run.build_number != null && Number.isFinite(Number(run.build_number))
    ? Number(run.build_number)
    : null;
  if (bn == null) {
    cell.appendChild(document.createTextNode('—'));
    return;
  }
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'test-run-build-link build-num-link';
  link.textContent = `#${bn}`;
  const job = String((run.suite || parentRow.suite) || '').trim();
  link.title = job ? `${job} #${bn}` : 'Open build';
  link.addEventListener('click', (e) => {
    e.stopPropagation();
    _openBuildFromTestRun(run, parentRow);
  });
  cell.appendChild(link);
}

function _updateTestsSortHdr() {
  const row = document.querySelector('#panel-tests thead tr.th-cols');
  if (!row) return;
  const ths = row.querySelectorAll('th');
  const map = [[0, 'name'], [1, 'suite'], [2, 'status'], [3, 'duration'], [4, 'timestamp']];
  map.forEach(([idx, key]) => {
    const th = ths[idx];
    if (!th) return;
    const base = String(th.getAttribute('data-sort-label') || th.textContent || '').trim();
    if (!th.getAttribute('data-sort-label')) th.setAttribute('data-sort-label', base);
    const arrow = _testsSort.key === key ? (_testsSort.dir === 'asc' ? ' ↑' : ' ↓') : '';
    th.textContent = base + arrow;
  });
}

function _initTestsSort() {
  if (_testsSortInit) return;
  const row = document.querySelector('#panel-tests thead tr.th-cols');
  if (!row) return;
  const ths = row.querySelectorAll('th');
  const map = [[0, 'name'], [1, 'suite'], [2, 'status'], [3, 'duration'], [4, 'timestamp']];
  map.forEach(([idx, key]) => {
    const th = ths[idx];
    if (!th) return;
    th.style.cursor = 'pointer';
    th.title = 'Sort';
    th.addEventListener('click', () => {
      if (_testsSort.key === key) _testsSort.dir = _testsSort.dir === 'asc' ? 'desc' : 'asc';
      else { _testsSort.key = key; _testsSort.dir = (key === 'name' || key === 'suite' || key === 'status') ? 'asc' : 'desc'; }
      _updateTestsSortHdr();
      resetTests();
    });
  });
  _testsSortInit = true;
  _updateTestsSortHdr();
}

function closeAllureMetaModal() {
  const ov = document.getElementById('allure-meta-modal');
  if (!ov) return;
  ov.classList.remove('open');
  ov.setAttribute('aria-hidden', 'true');
}

function _ensureAllureShotLightbox() {
  let ov = document.getElementById('allure-shot-modal');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'allure-shot-modal';
  ov.className = 'modal-overlay';
  ov.setAttribute('aria-hidden', 'true');
  ov.innerHTML = `
    <div class="allure-shot-modal-card" role="dialog" aria-modal="true" aria-labelledby="allure-shot-title">
      <div class="allure-shot-modal-head">
        <h3 id="allure-shot-title">Screenshot</h3>
        <button type="button" class="modal-btn modal-btn-cancel" id="allure-shot-close">${esc(t('common.close'))}</button>
      </div>
      <div class="allure-shot-modal-body">
        <img id="allure-shot-full" alt="" />
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', (e) => {
    if (e.target === ov) closeAllureShotLightbox();
  });
  const closeBtn = ov.querySelector('#allure-shot-close');
  if (closeBtn) closeBtn.addEventListener('click', closeAllureShotLightbox);
  const fullImg = ov.querySelector('#allure-shot-full');
  if (fullImg) fullImg.addEventListener('click', closeAllureShotLightbox);
  if (!window.__allureShotModalEscBound) {
    window.__allureShotModalEscBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const m = document.getElementById('allure-shot-modal');
        if (m && m.classList.contains('open')) closeAllureShotLightbox();
      }
    });
  }
  return ov;
}

function closeAllureShotLightbox() {
  const ov = document.getElementById('allure-shot-modal');
  if (!ov) return;
  const img = ov.querySelector('#allure-shot-full');
  if (img) {
    img.removeAttribute('src');
    img.removeAttribute('alt');
  }
  ov.classList.remove('open');
  ov.setAttribute('aria-hidden', 'true');
}

function openAllureShotLightbox(src, title = '') {
  const ov = _ensureAllureShotLightbox();
  const img = ov.querySelector('#allure-shot-full');
  const ttl = ov.querySelector('#allure-shot-title');
  if (!img || !ttl) return;
  img.src = String(src || '');
  img.alt = String(title || '');
  ttl.textContent = String(title || 'Screenshot');
  ov.classList.add('open');
  ov.setAttribute('aria-hidden', 'false');
}

function _buildSourceForFilter(src) {
  const s = String(src || '').trim().toLowerCase();
  if (s.startsWith('jenkins')) return 'jenkins';
  if (s === 'gitlab' || s.startsWith('gitlab_')) return 'gitlab';
  return '';
}

async function _resolveBuildUrlForTest(rowLike) {
  const direct = String((rowLike && rowLike.url) || '').trim();
  if (direct) return direct;
  const job = String((rowLike && (rowLike.suite || rowLike.test_name)) || '').trim();
  if (!job) return '';
  const src = _buildSourceForFilter(rowLike && rowLike.source);
  const inst = String((rowLike && rowLike.source_instance) || '').trim();
  const bn = rowLike && rowLike.build_number != null && Number.isFinite(Number(rowLike.build_number))
    ? Number(rowLike.build_number)
    : null;
  const u = apiUrl(`api/builds?page=1&per_page=200&source=${encodeURIComponent(src)}&instance=${encodeURIComponent(inst)}&status=&job=${encodeURIComponent(job)}&hours=0`);
  const res = await fetch(u).catch(() => null);
  if (!res || !res.ok) return '';
  const data = await res.json().catch(() => null);
  const items = data && Array.isArray(data.items) ? data.items : [];
  if (!items.length) return '';
  const exact = bn == null ? null : items.find((b) => Number(b && b.build_number) === bn);
  const pick = exact || items[0];
  return String((pick && pick.url) || '').trim();
}

function _openInternalBuildFromTest(rowLike) {
  const src = _buildSourceForFilter(rowLike && rowLike.source);
  const job = String((rowLike && (rowLike.suite || rowLike.test_name)) || '').trim();
  const inst = String((rowLike && rowLike.source_instance) || '').trim();
  const bn = rowLike && rowLike.build_number != null && Number.isFinite(Number(rowLike.build_number))
    ? Number(rowLike.build_number)
    : null;
  if (!job) {
    goToInTab('builds', 'panel-builds');
    return;
  }
  try { filterBuilds(src, '', job, inst || ''); } catch { goToInTab('builds', 'panel-builds'); }
  try { if (typeof _flashBuildRowForJob === 'function') window.requestAnimationFrame(() => _flashBuildRowForJob(job, bn)); } catch { /* ignore */ }
}

function _renderAllureDescription(body, text) {
  body.textContent = '';
  const content = (text && String(text).trim()) ? String(text).trim() : t('dash.allure_no_desc');
  const lines = content.split(/\r?\n/);
  const wrap = document.createElement('div');
  wrap.className = 'allure-desc-rich';
  let currentCard = null;
  let codeLines = [];
  const flushCode = () => {
    if (!currentCard || !codeLines.length) return;
    const pre = document.createElement('pre');
    pre.className = 'allure-desc-code';
    pre.textContent = codeLines.join('\n');
    currentCard.appendChild(pre);
    codeLines = [];
  };
  const ensureCard = (titleText) => {
    flushCode();
    const card = document.createElement('section');
    card.className = 'allure-desc-card';
    if (titleText) {
      const h = document.createElement('h4');
      h.className = 'allure-desc-card-title';
      h.textContent = titleText;
      card.appendChild(h);
    }
    wrap.appendChild(card);
    currentCard = card;
    return card;
  };
  const appendLine = (value, cls = '') => {
    if (!currentCard) ensureCard('');
    const row = document.createElement('div');
    row.className = `allure-desc-line${cls ? ` ${cls}` : ''}`;
    if (/^https?:\/\//i.test(value)) {
      const a = document.createElement('a');
      a.href = value;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = value;
      row.appendChild(a);
    } else {
      row.textContent = value;
    }
    currentCard.appendChild(row);
  };
  const isCodeLikeLine = (lineRaw) => {
    const line = String(lineRaw || '');
    const tline = line.trim();
    if (!tline) return false;
    return (
      /^[\[{]/.test(tline) ||
      /^[}\]],?$/.test(tline) ||
      /^["'][^"']+["']\s*:/.test(tline) ||
      /^\w+\s*:/.test(tline) && /[{\["'\d]/.test(tline) ||
      /^[-]{3,}$/.test(tline)
    );
  };
  lines.forEach((lineRaw) => {
    const value = String(lineRaw || '').trim();
    if (!value) {
      flushCode();
      return;
    }
    if (/^шаг\s*\d+/i.test(value)) {
      ensureCard(value);
      return;
    }
    if (isCodeLikeLine(lineRaw)) {
      codeLines.push(value);
      return;
    }
    if (/[:：]$/.test(value) && value.length <= 80) {
      flushCode();
      appendLine(value, 'label');
      return;
    }
    flushCode();
    appendLine(value);
  });
  flushCode();
  if (!wrap.childNodes.length) {
    ensureCard('');
    appendLine(content);
  }
  body.appendChild(wrap);
}

function openAllureDescriptionModal(ctx) {
  const ov = document.getElementById('allure-meta-modal');
  const title = document.getElementById('allure-meta-title');
  const sub = document.getElementById('allure-meta-sub');
  const body = document.getElementById('allure-meta-body');
  if (!ov || !title || !sub || !body) return;
  title.textContent = t('dash.allure_modal_desc');
  const uidLabel = String(ctx.uid || '').trim() || '—';
  const bnLabel = (ctx.build_number != null && Number.isFinite(Number(ctx.build_number)))
    ? String(Number(ctx.build_number))
    : '—';
  const jobName = String(ctx.suite || '').trim();
  const src = String(ctx.source || '').trim().toLowerCase();
  const srcInst = String(ctx.source_instance || '').trim();
  sub.textContent = '';
  if (jobName) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'test-error-build-link';
    btn.textContent = `${jobName} #${bnLabel}`;
    btn.title = 'Open related build';
    btn.addEventListener('click', () => {
      _openInternalBuildFromTest({ source: src, source_instance: srcInst, suite: jobName, build_number: ctx.build_number });
      closeAllureMetaModal();
    });
    sub.appendChild(btn);
    const ext = document.createElement('button');
    ext.type = 'button';
    ext.className = 'test-error-build-ext';
    ext.textContent = '↗ URL';
    ext.title = 'Open external build URL';
    ext.addEventListener('click', async () => {
      const url = await _resolveBuildUrlForTest({ source: src, source_instance: srcInst, suite: jobName, build_number: ctx.build_number });
      if (url) window.open(safeUrl(url), '_blank', 'noopener');
    });
    sub.appendChild(ext);
    const meta = document.createElement('span');
    meta.style.color = 'var(--muted)';
    meta.style.marginLeft = '.45rem';
    meta.textContent = `· ${uidLabel}`;
    sub.appendChild(meta);
  } else {
    sub.textContent = `${ctx.suite} #${bnLabel} · ${uidLabel}`;
  }
  body.textContent = '';
  const fill = (text) => { _renderAllureDescription(body, text); };
  if (ctx.cachedDescription && String(ctx.cachedDescription).trim()) {
    fill(ctx.cachedDescription);
  } else {
    const uidStr = String(ctx.uid || '').trim();
    const hasBn = ctx.build_number != null && Number.isFinite(Number(ctx.build_number));
    if (!uidStr || !hasBn) {
      fill(t('dash.allure_no_uid'));
    } else {
    body.textContent = t('dash.allure_loading');
    const u = new URLSearchParams();
    u.set('suite', ctx.suite);
    u.set('build_number', String(ctx.build_number));
    u.set('uid', uidStr);
    if (ctx.source_instance) u.set('source_instance', ctx.source_instance);
    fetch(apiUrl(`api/tests/jenkins-allure-details?${u.toString()}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        body.textContent = '';
        fill((d && d.description) ? d.description : '');
      })
      .catch(() => {
        body.textContent = '';
        fill(t('dash.allure_fetch_fail'));
      });
    }
  }
  ov.setAttribute('aria-hidden', 'false');
  ov.classList.add('open');
}

function openTestErrorModal(row) {
  const ov = document.getElementById('allure-meta-modal');
  const title = document.getElementById('allure-meta-title');
  const sub = document.getElementById('allure-meta-sub');
  const body = document.getElementById('allure-meta-body');
  if (!ov || !title || !sub || !body) return;
  const testName = String(row.test_name || '').trim() || '—';
  const src = String(row.source || '').trim() || 'unknown';
  const srcInst = String(row.source_instance || '').trim();
  const jobName = String(row.suite || row.test_name || '').trim();
  const buildNumber = row.build_number != null && Number.isFinite(Number(row.build_number))
    ? Number(row.build_number)
    : null;
  const sourceLabel = srcInst ? `${src} (${srcInst})` : src;
  title.textContent = t('dash.th_error');
  sub.textContent = testName;
  body.textContent = '';
  const meta = document.createElement('div');
  meta.className = 'test-error-meta';
  const sourcePill = document.createElement('span');
  sourcePill.className = 'test-error-source';
  sourcePill.textContent = sourceLabel;
  meta.appendChild(sourcePill);
  if (jobName) {
    const openBuildLink = document.createElement('button');
    openBuildLink.type = 'button';
    openBuildLink.className = 'test-error-build-link';
    openBuildLink.textContent = buildNumber ? `${jobName} #${buildNumber}` : jobName;
    openBuildLink.title = 'Open related build';
    openBuildLink.addEventListener('click', () => {
      _openInternalBuildFromTest({ source: src, source_instance: srcInst, suite: jobName, build_number: buildNumber });
      closeAllureMetaModal();
    });
    meta.appendChild(openBuildLink);
    const extBtn = document.createElement('button');
    extBtn.type = 'button';
    extBtn.className = 'test-error-build-ext';
    extBtn.textContent = '↗ URL';
    extBtn.title = 'Open external build URL';
    extBtn.addEventListener('click', async () => {
      const url = await _resolveBuildUrlForTest({ source: src, source_instance: srcInst, suite: jobName, build_number: buildNumber });
      if (url) window.open(safeUrl(url), '_blank', 'noopener');
    });
    meta.appendChild(extBtn);
  }
  body.appendChild(meta);
  const pre = document.createElement('pre');
  pre.className = 'test-error-modal-pre';
  pre.textContent = String(row.failure_message || '').trim() || '—';
  body.appendChild(pre);
  ov.setAttribute('aria-hidden', 'false');
  ov.classList.add('open');
}

function openAllureScreensModal(ctx) {
  const ov = document.getElementById('allure-meta-modal');
  const title = document.getElementById('allure-meta-title');
  const sub = document.getElementById('allure-meta-sub');
  const body = document.getElementById('allure-meta-body');
  if (!ov || !title || !sub || !body) return;
  title.textContent = t('dash.allure_modal_shots');
  const uidLabel2 = String(ctx.uid || '').trim() || '—';
  const bnLabel2 = (ctx.build_number != null && Number.isFinite(Number(ctx.build_number)))
    ? String(Number(ctx.build_number))
    : '—';
  const jobName2 = String(ctx.suite || '').trim();
  const src2 = String(ctx.source || '').trim().toLowerCase();
  const srcInst2 = String(ctx.source_instance || '').trim();
  sub.textContent = '';
  if (jobName2) {
    const btn2 = document.createElement('button');
    btn2.type = 'button';
    btn2.className = 'test-error-build-link';
    btn2.textContent = `${jobName2} #${bnLabel2}`;
    btn2.title = 'Open related build';
    btn2.addEventListener('click', () => {
      _openInternalBuildFromTest({ source: src2, source_instance: srcInst2, suite: jobName2, build_number: ctx.build_number });
      closeAllureMetaModal();
    });
    sub.appendChild(btn2);
    const ext2 = document.createElement('button');
    ext2.type = 'button';
    ext2.className = 'test-error-build-ext';
    ext2.textContent = '↗ URL';
    ext2.title = 'Open external build URL';
    ext2.addEventListener('click', async () => {
      const url = await _resolveBuildUrlForTest({ source: src2, source_instance: srcInst2, suite: jobName2, build_number: ctx.build_number });
      if (url) window.open(safeUrl(url), '_blank', 'noopener');
    });
    sub.appendChild(ext2);
    const meta2 = document.createElement('span');
    meta2.style.color = 'var(--muted)';
    meta2.style.marginLeft = '.45rem';
    meta2.textContent = `· ${uidLabel2}`;
    sub.appendChild(meta2);
  } else {
    sub.textContent = `${ctx.suite} #${bnLabel2} · ${uidLabel2}`;
  }
  body.textContent = '';
  const addImgs = (atts) => {
    if (!atts || !atts.length) {
      const p = document.createElement('p');
      p.style.color = 'var(--muted)';
      p.textContent = t('dash.allure_no_images');
      body.appendChild(p);
      return;
    }
    const groups = new Map();
    atts.forEach((a) => {
      const srcPath = String((a && a.source) || '');
      if (!srcPath) return;
      const stepName = String((a && a.step) || '').trim() || t('dash.allure_modal_shots');
      if (!groups.has(stepName)) groups.set(stepName, []);
      groups.get(stepName).push(a);
    });
    groups.forEach((items, stepName) => {
      const sec = document.createElement('section');
      sec.style.marginBottom = '.9rem';
      const h = document.createElement('h4');
      h.style.margin = '0 0 .45rem 0';
      h.style.fontSize = '.85rem';
      h.style.color = 'var(--muted)';
      h.textContent = stepName;
      sec.appendChild(h);
      const grid = document.createElement('div');
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = 'repeat(auto-fill,minmax(220px,1fr))';
      grid.style.gap = '.75rem';
      items.forEach((a) => {
        const srcPath = String((a && a.source) || '');
        if (!srcPath) return;
        const wrap = document.createElement('div');
        wrap.style.border = '1px solid var(--border)';
        wrap.style.borderRadius = '.5rem';
        wrap.style.padding = '.35rem';
        wrap.style.background = 'var(--surface2)';
        const cap = document.createElement('div');
        cap.style.fontSize = '.72rem';
        cap.style.color = 'var(--muted)';
        cap.style.marginBottom = '.25rem';
        cap.textContent = String((a && a.name) || srcPath);
        const img = document.createElement('img');
        img.alt = String((a && a.name) || '');
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.cursor = 'zoom-in';
        img.loading = 'lazy';
        const q = new URLSearchParams();
        q.set('suite', ctx.suite);
        q.set('build_number', String(ctx.build_number));
        q.set('src', srcPath);
        if (ctx.source_instance) q.set('source_instance', ctx.source_instance);
        img.src = apiUrl(`api/tests/jenkins-allure-attachment?${q.toString()}`);
        img.addEventListener('click', () => {
          openAllureShotLightbox(
            img.src,
            `${String((a && a.step) || '').trim() ? `${String((a && a.step) || '').trim()} - ` : ''}${String((a && a.name) || srcPath)}`
          );
        });
        wrap.appendChild(cap);
        wrap.appendChild(img);
        grid.appendChild(wrap);
      });
      sec.appendChild(grid);
      body.appendChild(sec);
    });
  };

  if (ctx.cachedAttachments && ctx.cachedAttachments.length) {
    addImgs(ctx.cachedAttachments);
  } else {
    const uidStr2 = String(ctx.uid || '').trim();
    const hasBn2 = ctx.build_number != null && Number.isFinite(Number(ctx.build_number));
    if (!uidStr2 || !hasBn2) {
      addImgs([]);
    } else {
    body.textContent = t('dash.allure_loading');
    const u = new URLSearchParams();
    u.set('suite', ctx.suite);
    u.set('build_number', String(ctx.build_number));
    u.set('uid', uidStr2);
    if (ctx.source_instance) u.set('source_instance', ctx.source_instance);
    fetch(apiUrl(`api/tests/jenkins-allure-details?${u.toString()}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        body.textContent = '';
        addImgs((d && d.attachments) ? d.attachments : []);
      })
      .catch(() => {
        body.textContent = '';
        const p = document.createElement('p');
        p.textContent = t('dash.allure_fetch_fail');
        body.appendChild(p);
      });
    }
  }
  ov.setAttribute('aria-hidden', 'false');
  ov.classList.add('open');
}

/**
 * Allure description/screenshot actions for a row-like object (test-runs + top failures).
 * Works with filter ``real``: rows remain ``jenkins_unified``; show buttons if we can fetch
 * (``allure_uid`` + ``build_number``) or show cached description/attachments from collect.
 */
function buildAllureActionButtonsFragment(row) {
  const src = String(row.source || '').toLowerCase();
  const j = src === 'jenkins_unified' || src === 'jenkins_allure';
  const hasBn = row.build_number != null && Number.isFinite(Number(row.build_number));
  const uid = (row.allure_uid != null && String(row.allure_uid).trim())
    ? String(row.allure_uid).trim()
    : (row.allureUid != null && String(row.allureUid).trim() ? String(row.allureUid).trim() : '');
  const desc = (row.allure_description != null ? String(row.allure_description) : '')
    || (row.allureDescription != null ? String(row.allureDescription) : '');
  const att = Array.isArray(row.allure_attachments) ? row.allure_attachments
    : (Array.isArray(row.allureAttachments) ? row.allureAttachments : null);
  const hasDesc = desc.trim().length > 0;
  const hasAtt = att && att.length > 0;
  const canFetch = uid.length > 0 && hasBn;
  const wantDesc = canFetch || hasDesc;
  const wantShots = canFetch || hasAtt;
  if (!j || (!wantDesc && !wantShots)) return null;
  const inst = row.source_instance != null ? String(row.source_instance)
    : (row.sourceInstance != null ? String(row.sourceInstance) : '');
  const ctx = {
    suite: String(row.suite || ''),
    build_number: Number(row.build_number),
    uid,
    source: String(row.source || ''),
    source_instance: inst,
    cachedDescription: hasDesc ? desc : '',
    cachedAttachments: hasAtt ? att : null,
  };
  const frag = document.createDocumentFragment();
  if (wantDesc) {
    const b1 = document.createElement('button');
    b1.type = 'button';
    b1.className = 'btn btn-ghost';
    b1.style.fontSize = '.68rem';
    b1.style.padding = '.2rem .4rem';
    b1.textContent = t('dash.allure_desc_btn');
    b1.addEventListener('click', () => { openAllureDescriptionModal(ctx); });
    frag.appendChild(b1);
  }
  if (wantShots) {
    if (wantDesc) frag.appendChild(document.createTextNode(' '));
    const b2 = document.createElement('button');
    b2.type = 'button';
    b2.className = 'btn btn-ghost';
    b2.style.fontSize = '.68rem';
    b2.style.padding = '.2rem .4rem';
    b2.textContent = t('dash.allure_shots_btn');
    b2.addEventListener('click', () => { openAllureScreensModal(ctx); });
    frag.appendChild(b2);
  }
  return frag;
}

window.buildAllureActionButtonsFragment = buildAllureActionButtonsFragment;

function _allureActionsCell(row) {
  const td = document.createElement('td');
  td.className = 'col-compact-hide';
  td.style.whiteSpace = 'nowrap';
  const frag = buildAllureActionButtonsFragment(row);
  if (!frag) {
    td.appendChild(document.createTextNode('—'));
    return td;
  }
  td.appendChild(frag);
  return td;
}

function summarizeFailureMessage(raw) {
  const full = String(raw || '').trim();
  if (!full) return '';
  const compact = full.replace(/\s+/g, ' ').trim();
  const lines = full
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const keyLine = lines.find((line) => /(?:error|exception|failed|assert)/i.test(line)) || lines[0] || compact;
  const clean = keyLine.replace(/^E\s+/, '').trim();
  const maxLen = 140;
  return clean.length > maxLen ? `${clean.slice(0, maxLen - 1)}…` : clean;
}

function resetTests() {
  resetTestsSoft(!!_liveMode);
}
function resetTestsSoft(soft=false) {
  abortFetchKey('tests');
  _testsLoadGen++;
  const s = _state.tests; s.page=1; s.done=false; s.loading = false;
  const tb = document.getElementById('tbody-tests');
  if (!soft && tb) tb.innerHTML = `<tr class="empty-row"><td colspan="7">${esc(t('dash.table_loading'))}</td></tr>`;
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
  const uiSrc = document.getElementById('f-tsource')?.value || '';
  const src = _mapTestSourceForApi(uiSrc);
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
  const q = (extra) => `api/export/failures?fmt=${extra}&n=10000${src ? '&source=' + encodeURIComponent(src) : ''}${d}`;
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

function _mkTestSrcBadge(src) {
  const s = String(src || '').toLowerCase();
  const span = document.createElement('span');
  span.className = 'b';
  span.style.fontSize = '.66rem';
  if (s === 'jenkins_unified') { span.className = 'b b-info'; span.title = 'Merged (Allure+Console+Build)'; span.textContent = 'UNIFIED'; return span; }
  if (s === 'jenkins_allure') { span.className = 'b b-green'; span.title = 'Allure'; span.textContent = 'ALLURE'; return span; }
  if (s === 'jenkins_console') { span.className = 'b b-purple'; span.title = 'Console'; span.textContent = 'CONSOLE'; return span; }
  if (s === 'jenkins_build') { span.className = 'b b-yellow'; span.title = 'Synthetic (job as test)'; span.textContent = 'JOB'; return span; }
  span.title = s;
  span.textContent = s ? s.slice(0, 10) : '';
  return span;
}

function _appendTestResultCells(tr, row, opts = {}) {
  const child = !!opts.child;
  const td1 = document.createElement('td');
  td1.style.maxWidth = '160px';
  td1.style.color = 'var(--muted)';
  td1.style.fontSize = '.78rem';
  td1.title = String(row.suite || '');
  td1.textContent = child ? '—' : String(row.suite || '');

  const td2 = document.createElement('td');
  td2.innerHTML = badge(row.status);

  const td3 = document.createElement('td');
  td3.style.whiteSpace = 'nowrap';
  td3.textContent = dur(row.duration_seconds);

  const td4 = document.createElement('td');
  td4.style.whiteSpace = 'nowrap';
  td4.style.fontSize = '.78rem';
  td4.textContent = fmt(row.timestamp);

  const td5 = _allureActionsCell(row);

  const td6 = document.createElement('td');
  td6.className = 'col-compact-hide test-error-cell';
  const fullErr = String(row.failure_message || '').trim();
  const compactErr = summarizeFailureMessage(fullErr);
  if (fullErr) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'test-error-btn';
    btn.title = fullErr;
    btn.textContent = compactErr || t('dash.th_error');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTestErrorModal(row);
    });
    td6.appendChild(btn);
  } else {
    td6.textContent = '—';
  }

  tr.append(td1, td2, td3, td4, td5, td6);
}

function _renderTestGroupsTable(groups) {
  const frag = document.createDocumentFragment();
  groups.forEach((group) => {
    const row = group.latest;
    const encKey = encodeURIComponent(group.key);
    const expanded = _expandedTestGroups.has(group.key);
    const multi = group.runs.length > 1;

    const tr = document.createElement('tr');
    tr.className = 'test-group-row' + (expanded ? ' is-expanded' : '');
    tr.setAttribute('data-tgroup', encKey);
    tr.setAttribute('data-test-name', String(row.test_name || ''));
    tr.setAttribute('data-test-suite', String(row.suite || ''));

    const td0 = document.createElement('td');
    td0.style.maxWidth = '260px';
    td0.style.wordBreak = 'break-word';
    td0.title = String(row.test_name || '');
    const stack = document.createElement('div');
    stack.className = 'cell-stack test-name-stack';
    if (multi) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'test-grp-toggle grp-toggle';
      toggle.textContent = expanded ? '−' : '+';
      toggle.title = 'Show run history';
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleTestGroup(encKey);
      });
      stack.appendChild(toggle);
    }
    if (row.source) stack.appendChild(_mkTestSrcBadge(row.source));
    const nameSpan = document.createElement('span');
    nameSpan.className = 'cell-main';
    nameSpan.textContent = String(row.test_name || '');
    stack.appendChild(nameSpan);
    if (multi) {
      const cnt = document.createElement('span');
      cnt.className = 'test-runs-count';
      cnt.textContent = `${group.runs.length} runs`;
      stack.appendChild(cnt);
    }
    td0.appendChild(stack);
    tr.appendChild(td0);
    _appendTestResultCells(tr, row);

    tr.addEventListener('click', (e) => {
      if (!multi) return;
      if (e.target.closest('button, a')) return;
      toggleTestGroup(encKey);
    });
    frag.appendChild(tr);

    if (multi) {
      group.runs.forEach((run, idx) => {
        if (idx === 0) return;
        const ctr = document.createElement('tr');
        ctr.className = 'test-run-child';
        ctr.setAttribute('data-tgroup', encKey);
        ctr.style.display = expanded ? '' : 'none';

        const ctd0 = document.createElement('td');
        ctd0.className = 'test-run-child-name';
        ctd0.title = String(run.suite || row.suite || '');
        _appendRunBuildLink(ctd0, run, row);
        ctr.appendChild(ctd0);
        _appendTestResultCells(ctr, run, { child: true });
        frag.appendChild(ctr);
      });
    }
  });
  return frag;
}

async function loadTests() {
  _initTestsSort();
  _migrateLegacyTestSourceSelect();
  const s = _state.tests;
  if (s.loading || s.done) return;

  const tbody = document.getElementById('tbody-tests');
  if (guardPanelLoadDuringCollect('tests', tbody, s)) return;
  const incr = typeof isCollectIncrementalRefresh === 'function' && isCollectIncrementalRefresh();
  if (!incr && s.page === 1 && typeof shouldSkipTableReloadDuringCollect === 'function' && shouldSkipTableReloadDuringCollect('tests', tbody)) {
    s.done = true;
    s.loading = false;
    return;
  }

  const myGen = ++_testsLoadGen;
  s.loading = true;

  try {
    _syncTestSourceQuickButtons();
    const status = document.getElementById('f-tstatus').value;
    const uiSource = _normalizeTestSourceUi(document.getElementById('f-tsource').value);
    const apiSource = _mapTestSourceForApi(uiSource);
    const name = document.getElementById('f-tname').value;
    const suite = document.getElementById('f-tsuite').value;
    const allRuns = [];
    let breakdown = null;
    let apiTotal = 0;
    const pageSize = incr && typeof collectIncrementalPerPage === 'function'
      ? collectIncrementalPerPage(s.per_page)
      : s.per_page;

    while (myGen === _testsLoadGen && !s.done) {
      const url = apiUrl(
        `api/tests?page=${s.page}&per_page=${pageSize}&status=${encodeURIComponent(status)}`
        + `&source=${encodeURIComponent(apiSource)}&name=${encodeURIComponent(name)}&suite=${encodeURIComponent(suite)}&hours=${_testsHours}`
      );
      const res = await fetchKeyed('tests', url).catch(() => null);
      if (myGen !== _testsLoadGen) return;
      if (res === FETCH_ABORTED) return;
      if (!res || !res.ok) {
        if (keepTableOnTransientApiError(tbody, res, s, 'tests')) return;
        if (res && res.status === 404) {
          tbody.innerHTML = `<tr class="empty-row"><td colspan="7">${esc(t('dash.table_no_test_data'))}${emptyStateActionsHtml()}</td></tr>`;
        } else {
          const detail = await fetchApiErrorDetail(res);
          srAnnounce(t('dash.table_api_err') + (detail ? ': ' + detail : ''), 'assertive');
          const extra = detail ? ` — ${esc(detail)}` : '';
          tbody.innerHTML = `<tr class="empty-row"><td colspan="7">${esc(t('dash.table_api_err'))}${extra}<br/><span class="err-hint">${esc(t('err.hint_retry'))}</span> <button type="button" class="btn btn-ghost" onclick="refreshAll()">${esc(t('common.retry'))}</button></td></tr>`;
        }
        s.done = true;
        updateFilterSummary();
        _applyGlobalSearch();
        return;
      }

      const data = await res.json();
      if (myGen !== _testsLoadGen) return;
      apiTotal = Number(data.total || 0);
      if (data.breakdown) breakdown = data.breakdown;
      allRuns.push(...(data.items || []));
      if (incr || !data.has_more) break;
      s.page++;
    }

    const groups = _sortTestGroups(_groupTestRuns(allRuns));
    s.total = groups.length;
    const countEl = document.getElementById('tests-count');
    if (countEl) countEl.textContent = String(groups.length);
    if (breakdown) {
      const b = breakdown;
      const el = document.getElementById('tests-breakdown');
      if (el) el.textContent = `Jenkins: ${b.real_total || 0} (${b.real_failed || 0} failed) · runs: ${apiTotal}`;
    }

    if (!groups.length) {
      if (keepTableOnTransientEmpty(tbody, groups, s, 'tests')) return;
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7"><div>${esc(t('dash.table_no_tests'))}</div><div class="empty-hint">${t('dash.empty_tests_hint')}</div>${emptyStateActionsHtml()}</td></tr>`;
      s.done = true;
      updateFilterSummary();
      _applyGlobalSearch();
      return;
    }

    const pageSig = groups.map((g) => [
      g.key,
      String(g.runs.length),
      String(g.latest.status_normalized || g.latest.status || ''),
      String(g.latest.timestamp || ''),
    ].join('\x1f')).join('\x1e');
    if (_liveMode && pageSig && pageSig === _lastTestsPageSig) {
      s.done = true;
      updateFilterSummary();
      _applyGlobalSearch();
      return;
    }
    _lastTestsPageSig = pageSig;

    const frag = _renderTestGroupsTable(groups);
    swapTableContentSmooth(tbody, () => {
      tbody.replaceChildren(frag);
      try { cacheStaleTableHtml('tests', tbody); } catch { /* ignore */ }
      groups.forEach((g) => {
        if (_expandedTestGroups.has(g.key)) applyTestGroupVisibility(encodeURIComponent(g.key));
      });
    });

    s.done = true;
    _applyGlobalSearch();
    updateFilterSummary();
  } finally {
    if (myGen === _testsLoadGen) s.loading = false;
  }
}
