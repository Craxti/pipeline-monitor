let _harLast = null;
let _harRawText = '';
const _HAR_RAW_MAX_CHARS = 300000;
const _HAR_I18N_FALLBACKS = {
  'dash.har_show_raw': 'Show file',
  'dash.har_hide_raw': 'Hide file',
  'dash.har_no_file_loaded': 'No file loaded yet.',
  'dash.har_raw_truncated': 'preview truncated to keep UI responsive',
  'dash.har_no_data': 'No data',
  'dash.har_count': 'count',
  'dash.har_nothing_found': 'Nothing found',
  'dash.har_status_label': 'status',
  'dash.har_kpi_total': 'Total',
  'dash.har_kpi_failed': 'Failed',
  'dash.har_kpi_slow': 'Slow',
  'dash.har_kpi_avg_ms': 'Avg ms',
  'dash.har_failed_requests': 'Requests with errors',
  'dash.har_slow_requests': 'Slow requests',
  'dash.har_choose_file': 'Choose a HAR file first.',
  'dash.har_analyzing': 'Analyzing...',
  'dash.har_analyze_failed': 'HAR analyze failed',
  'dash.har_loaded_prefix': 'Loaded',
  'dash.har_analyzed_toast': 'HAR analyzed',
};

function _harEl(id) {
  return document.getElementById(id);
}

function _harEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _harT(key) {
  try {
    const v = t(key);
    if (v && v !== key) return v;
  } catch {
    /* ignore */
  }
  return _HAR_I18N_FALLBACKS[key] || key;
}

function _harMetric(v) {
  if (v == null || Number.isNaN(Number(v))) return '0';
  return String(Math.round(Number(v) * 100) / 100);
}

function _harGetFilters() {
  const slow = parseInt(_harEl('har-slow-threshold')?.value || '2000', 10);
  return {
    status: (_harEl('har-filter-status')?.value || 'all'),
    host: String(_harEl('har-filter-host')?.value || '').trim().toLowerCase(),
    url: String(_harEl('har-filter-url')?.value || '').trim().toLowerCase(),
    slowMs: Number.isFinite(slow) && slow > 0 ? slow : 2000,
  };
}

function _harMatch(r, f) {
  const status = Number(r?.status || 0);
  const err = String(r?.error || '').trim();
  if (f.status === '4xx' && !(status >= 400 && status < 500)) return false;
  if (f.status === '5xx' && !(status >= 500)) return false;
  if (f.status === 'error' && !err) return false;
  if (f.host) {
    let host = '';
    try { host = new URL(String(r?.url || '')).host.toLowerCase(); } catch { host = ''; }
    if (!host.includes(f.host)) return false;
  }
  if (f.url && !String(r?.url || '').toLowerCase().includes(f.url)) return false;
  return true;
}

function _harRenderPairs(containerId, items, keyName) {
  const el = _harEl(containerId);
  if (!el) return;
  if (!items || !items.length) {
    el.innerHTML = `<div class="dhar-row">${_harEsc(_harT('dash.har_no_data'))}</div>`;
    return;
  }
  el.innerHTML = items.map((it, idx) => `
    <div class="dhar-row">
      <div class="dhar-row-top">
        <span class="mono" style="opacity:.75">#${idx + 1}</span>
        <span class="mono">${_harEsc(it[keyName])}</span>
        <span style="margin-left:auto">${_harEsc(_harT('dash.har_count'))}: <b>${_harEsc(String(it.count || 0))}</b></span>
      </div>
    </div>
  `).join('');
}

function _harRenderRequests(containerId, items, kind) {
  const el = _harEl(containerId);
  if (!el) return;
  if (!items || !items.length) {
    el.innerHTML = `<div class="dhar-row">${_harEsc(_harT('dash.har_nothing_found'))}</div>`;
    return;
  }
  el.innerHTML = items.map((r) => {
    const status = Number(r?.status || 0);
    const cls = status >= 500 ? 'err' : (status >= 400 ? 'warn' : 'ok');
    const right = kind === 'failed'
      ? (r?.error ? _harEsc(r.error) : `${_harEsc(_harT('dash.har_status_label'))} ${_harEsc(String(r?.status ?? 'n/a'))}`)
      : `${_harEsc(_harMetric(r?.time_ms))} ms`;
    return `
      <div class="dhar-row">
        <div class="dhar-row-top">
          <span class="dhar-method mono">${_harEsc(r?.method || 'GET')}</span>
          <span class="dhar-status ${cls} mono">${_harEsc(String(r?.status ?? 'n/a'))}</span>
          <span class="mono" style="margin-left:auto">${right}</span>
        </div>
        <div class="dhar-url">${_harEsc(r?.url || '')}</div>
      </div>
    `;
  }).join('');
}

function _harRenderSummary(summary) {
  const el = _harEl('har-summary');
  if (!el) return;
  el.style.display = '';
  const tiles = [
    { key: _harT('dash.har_kpi_total'), value: summary?.total_requests },
    { key: _harT('dash.har_kpi_failed'), value: summary?.failed_requests },
    { key: _harT('dash.har_kpi_slow'), value: summary?.slow_requests },
    { key: _harT('dash.har_kpi_avg_ms'), value: _harMetric(summary?.avg_time_ms) },
  ];
  el.innerHTML = tiles.map((t) => `
    <div class="dhar-kpi">
      <div class="dhar-kpi-k">${_harEsc(t.key)}</div>
      <div class="dhar-kpi-v mono">${_harEsc(String(t.value ?? 0))}</div>
    </div>
  `).join('');
}

function _harRenderRaw() {
  const pre = _harEl('har-raw-pre');
  const modeEl = _harEl('har-raw-mode');
  const qEl = _harEl('har-raw-search');
  const meta = _harEl('har-raw-meta');
  const btn = _harEl('har-toggle-raw-btn');
  if (!pre || !btn) return;
  btn.textContent = _harT('dash.har_show_raw');
  const mode = modeEl?.value || 'full';
  const q = String(qEl?.value || '').trim().toLowerCase();
  let text = _harRawText || '';
  if (mode === 'filtered') {
    text = _harBuildFilteredRawText();
  }
  if (!_harRawText) {
    pre.textContent = _harT('dash.har_no_file_loaded');
    if (meta) meta.textContent = '';
    return;
  }
  if (text.length > _HAR_RAW_MAX_CHARS) {
    text = text.slice(0, _HAR_RAW_MAX_CHARS) + '\n\n... ' + _harT('dash.har_raw_truncated');
  }
  if (q) {
    const lines = text.split('\n');
    const matched = lines.filter((ln) => ln.toLowerCase().includes(q));
    if (matched.length) {
      text = matched.join('\n');
      if (meta) meta.textContent = `${_harT('dash.har_count')}: ${matched.length}`;
    } else {
      text = _harT('dash.har_nothing_found');
      if (meta) meta.textContent = `${_harT('dash.har_count')}: 0`;
    }
  } else {
    const count = text ? text.split('\n').length : 0;
    if (meta) meta.textContent = `${_harT('dash.har_count')}: ${count}`;
  }
  pre.textContent = text;
}

function _harBuildFilteredRawText() {
  if (!_harLast) return _harRawText || '';
  const f = _harGetFilters();
  const failed = (_harLast.failed_requests || []).filter((r) => _harMatch(r, f));
  const slow = (_harLast.slow_requests || []).filter((r) => _harMatch(r, f) && Number(r?.time_ms || 0) >= f.slowMs);
  const payload = {
    file_name: _harLast.file_name,
    filters: f,
    summary: _harLast.summary || {},
    top_statuses: _harLast.top_statuses || [],
    top_hosts: _harLast.top_hosts || [],
    failed_requests: failed,
    slow_requests: slow,
  };
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return _harRawText || '';
  }
}

function openHarRawModal() {
  const ov = _harEl('har-raw-modal');
  if (!ov) return;
  ov.classList.add('open');
  ov.setAttribute('aria-hidden', 'false');
  _harRenderRaw();
}

function closeHarRawModal() {
  const ov = _harEl('har-raw-modal');
  if (!ov) return;
  ov.classList.remove('open');
  ov.setAttribute('aria-hidden', 'true');
}

function applyHarFilters() {
  if (!_harLast) return;
  const f = _harGetFilters();
  const failed = (_harLast.failed_requests || []).filter((r) => _harMatch(r, f));
  const slow = (_harLast.slow_requests || []).filter((r) => _harMatch(r, f) && Number(r?.time_ms || 0) >= f.slowMs);
  _harRenderRequests('har-failed', failed, 'failed');
  _harRenderRequests('har-slow', slow, 'slow');
  const meta = _harEl('har-filter-meta');
  if (meta) {
    meta.textContent = `${_harT('dash.har_failed_requests')}: ${failed.length} · ${_harT('dash.har_slow_requests')}: ${slow.length}`;
  }
}

function _harRenderResult(data) {
  _harLast = data || {};
  _harRenderSummary(_harLast.summary || {});
  _harRenderPairs('har-statuses', _harLast.top_statuses || [], 'status');
  _harRenderPairs('har-hosts', _harLast.top_hosts || [], 'host');
  applyHarFilters();
  _harRenderRaw();
}

async function analyzeHar() {
  const input = _harEl('har-file');
  const btn = _harEl('har-analyze-btn');
  const st = _harEl('har-status');
  const file = input?.files?.[0];
  if (!file) {
    if (st) st.textContent = _harT('dash.har_choose_file');
    return;
  }
  const form = new FormData();
  form.append('file', file);
  try {
    const txt = await file.text();
    try {
      _harRawText = JSON.stringify(JSON.parse(txt), null, 2);
    } catch {
      _harRawText = txt;
    }
  } catch {
    _harRawText = '';
  }
  if (btn) btn.disabled = true;
  if (st) st.textContent = _harT('dash.har_analyzing');
  const res = await fetch(apiUrl('api/har/analyze'), { method: 'POST', body: form }).catch(() => null);
  if (btn) btn.disabled = false;
  if (!res || !res.ok) {
    const err = (res && await res.json().catch(() => ({}))) || {};
    const msg = err.detail || _harT('dash.har_analyze_failed');
    if (st) st.textContent = msg;
    if (typeof showToast === 'function') showToast(msg, 'err');
    return;
  }
  const data = await res.json().catch(() => ({}));
  _harRenderResult(data);
  if (st) st.textContent = `${_harT('dash.har_loaded_prefix')}: ${data.file_name || file.name}`;
  if (typeof showToast === 'function') showToast(_harT('dash.har_analyzed_toast'), 'ok');
}

function initHarPanelBindings() {
  ['har-filter-status', 'har-filter-host', 'har-filter-url', 'har-slow-threshold'].forEach((id) => {
    const el = _harEl(id);
    if (!el) return;
    const evt = (id === 'har-filter-status') ? 'change' : 'input';
    el.addEventListener(evt, applyHarFilters);
  });
  const mode = _harEl('har-raw-mode');
  if (mode) mode.addEventListener('change', _harRenderRaw);
  const search = _harEl('har-raw-search');
  if (search) search.addEventListener('input', _harRenderRaw);
}

function refreshHarI18n() {
  if (_harLast) _harRenderResult(_harLast);
  _harRenderRaw();
}

function setHarPreset(mode) {
  const status = _harEl('har-filter-status');
  const host = _harEl('har-filter-host');
  const url = _harEl('har-filter-url');
  const slow = _harEl('har-slow-threshold');
  if (mode === '5xx') {
    if (status) status.value = '5xx';
  } else if (mode === 'errors') {
    if (status) status.value = 'error';
  } else if (mode === 'slow') {
    if (status) status.value = 'all';
    if (slow && (!slow.value || Number(slow.value) < 2000)) slow.value = '2000';
  } else {
    if (status) status.value = 'all';
    if (host) host.value = '';
    if (url) url.value = '';
  }
  applyHarFilters();
}

function toggleHarRawView() {
  openHarRawModal();
}
