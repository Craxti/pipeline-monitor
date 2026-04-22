// All test runs + export link helpers: dashboard.tests.js
// Load before dashboard.failures.js (shared Allure button builder on ``window``), before dashboard.services.js.

// ─────────────────────────────────────────────────────────────────────────────
// ALL TEST RUNS
// ─────────────────────────────────────────────────────────────────────────────
let _lastTestsPageSig = '';

function closeAllureMetaModal() {
  const ov = document.getElementById('allure-meta-modal');
  if (!ov) return;
  ov.classList.remove('open');
  ov.setAttribute('aria-hidden', 'true');
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
  sub.textContent = `${ctx.suite} #${bnLabel} · ${uidLabel}`;
  body.textContent = '';
  const fill = (text) => {
    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.fontFamily = 'inherit';
    pre.style.margin = '0';
    pre.textContent = (text && String(text).trim()) ? String(text).trim() : t('dash.allure_no_desc');
    body.appendChild(pre);
  };
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
  sub.textContent = `${ctx.suite} #${bnLabel2} · ${uidLabel2}`;
  body.textContent = '';
  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(auto-fill,minmax(220px,1fr))';
  grid.style.gap = '.75rem';

  const addImgs = (atts) => {
    if (!atts || !atts.length) {
      const p = document.createElement('p');
      p.style.color = 'var(--muted)';
      p.textContent = t('dash.allure_no_images');
      body.appendChild(p);
      return;
    }
    atts.forEach((a) => {
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
      img.loading = 'lazy';
      const q = new URLSearchParams();
      q.set('suite', ctx.suite);
      q.set('build_number', String(ctx.build_number));
      q.set('src', srcPath);
      if (ctx.source_instance) q.set('source_instance', ctx.source_instance);
      img.src = apiUrl(`api/tests/jenkins-allure-attachment?${q.toString()}`);
      wrap.appendChild(cap);
      wrap.appendChild(img);
      grid.appendChild(wrap);
    });
    body.appendChild(grid);
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

function resetTests() {
  resetTestsSoft(!!_liveMode);
}
function resetTestsSoft(soft=false) {
  // If a previous page load is in-flight, cancel it so new filters apply immediately.
  abortFetchKey('tests');
  const s = _state.tests; s.page=1; s.done=false; s.loading = false;
  const tb = document.getElementById('tbody-tests');
  if (!soft) tb.innerHTML = `<tr class="empty-row"><td colspan="7">${esc(t('dash.table_loading'))}</td></tr>`;
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
    if (keepTableOnTransientApiError(tbody, res, s)) return;
    if (res && res.status === 404) { tbody.innerHTML = `<tr class="empty-row"><td colspan="7">${esc(t('dash.table_no_test_data'))}${emptyStateActionsHtml()}</td></tr>`; }
    else {
      const detail = await fetchApiErrorDetail(res);
      srAnnounce(t('dash.table_api_err') + (detail ? ': ' + detail : ''), 'assertive');
      const extra = detail ? ` — ${esc(detail)}` : '';
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7">${esc(t('dash.table_api_err'))}${extra}<br/><span class="err-hint">${esc(t('err.hint_retry'))}</span> <button type="button" class="btn btn-ghost" onclick="refreshAll()">${esc(t('common.retry'))}</button></td></tr>`;
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
    if (keepTableOnTransientEmpty(tbody, rows, s)) return;
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7"><div>${esc(t('dash.table_no_tests'))}</div><div class="empty-hint">${t('dash.empty_tests_hint')}</div>${emptyStateActionsHtml()}</td></tr>`;
    s.done = true; updateFilterSummary(); _applyGlobalSearch(); return;
  }

  const mkSrcBadge = (src) => {
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
  };
  const frag = document.createDocumentFragment();
  const _testRowSig = (r) => [
    String(r.test_name || ''),
    String(r.suite || ''),
    String(r.status_normalized || r.status || ''),
    String(r.duration_seconds ?? ''),
    String(r.timestamp || ''),
    String(r.failure_message || ''),
    String(r.source || ''),
    String(r.source_instance || ''),
    String(r.allure_uid || ''),
    String((r.allure_attachments && r.allure_attachments.length) || 0),
  ].join('\x1f');
  const pageSig = rows.map(_testRowSig).join('\x1e');
  if (s.page === 1 && _liveMode && pageSig && pageSig === _lastTestsPageSig) {
    _applyGlobalSearch();
    updateFilterSummary();
    if (!data.has_more) s.done = true;
    return;
  }
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

    const td5 = _allureActionsCell(row);

    const td6 = document.createElement('td');
    td6.className = 'col-compact-hide';
    td6.style.maxWidth = '360px';
    td6.style.wordBreak = 'break-word';
    td6.style.fontSize = '.78rem';
    td6.style.color = 'var(--muted)';
    td6.title = String(row.failure_message || '');
    td6.textContent = String(row.failure_message || '');

    tr.append(td0, td1, td2, td3, td4, td5, td6);
    frag.appendChild(tr);
  });
  if (s.page === 1) {
    _lastTestsPageSig = pageSig;
    swapTableContentSmooth(tbody, () => { tbody.replaceChildren(frag); });
  }
  else tbody.appendChild(frag);

  _applyGlobalSearch();
  updateFilterSummary();
  if (!data.has_more) { s.done = true; return; }
  s.page++;
}
