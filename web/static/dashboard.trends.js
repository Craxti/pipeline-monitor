// ─────────────────────────────────────────────────────────────────────────────
// Trends charts
// ─────────────────────────────────────────────────────────────────────────────
let _trendsCharts = [];
let _trendsViewDays = 14;
let _trendsRawCache = null;
let _trendsRangeActive = false;
let _trendsRangeFrom = '';
let _trendsRangeTo = '';
let _trendsSmooth = 'none';
let _trendsTopN = 10;
let _trendsSource = '';
let _trendsInstSel = { builds: '', tests: '', top: '' };

async function populateTrendsInstanceFilters() {
  const ids = {
    builds: 'trends-inst-builds',
    tests: 'trends-inst-tests',
    top: 'trends-inst-top',
  };
  let items = [];
  try {
    const res = await fetch(apiUrl('api/instances')).catch(() => null);
    if (res && res.ok) items = (await res.json()) || [];
  } catch { /* ignore */ }

  const opts = [{ value: '', label: 'All instances' }];
  (items || []).forEach((it) => {
    const src = String(it.source || '').toLowerCase();
    const name = String(it.name || '').trim();
    if (!src || !name) return;
    opts.push({ value: `${src}|${name}`, label: `${src} · ${name}` });
  });

  Object.entries(ids).forEach(([k, id]) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const saved = (localStorage.getItem('cimon-trends-inst-' + k) || '').trim();
    sel.innerHTML = opts.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
    if (saved && opts.some((o) => o.value === saved)) sel.value = saved;
    sel.addEventListener('change', () => {
      try { localStorage.setItem('cimon-trends-inst-' + k, sel.value || ''); } catch { /* ignore */ }
    }, { passive: true });
  });
}

function _chartColors() {
  const light = document.documentElement.classList.contains('light');
  return {
    grid: light ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.07)',
    text: light ? '#64748b' : '#94a3b8',
  };
}

function _destroyCharts() {
  _trendsCharts.forEach(c => c && c.destroy());
  _trendsCharts = [];
}

function _mkLine(id, labels, datasets, opts) {
  opts = opts || {};
  const {grid, text} = _chartColors();
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return null;
  const yPrec = opts.yPrecision;
  const yTick = {};
  if (yPrec != null) {
    yTick.precision = yPrec;
    yTick.callback = (v) => (typeof v === 'number' ? v.toFixed(yPrec) : v);
  } else {
    yTick.precision = 0;
  }
  const showGrid = opts.showGrid !== false;
  const g = showGrid ? { color: grid } : { display: false };
  const yScale = { beginAtZero: opts.yBeginAtZero !== false, ticks: { color: text, font: { size: 10 }, ...yTick }, grid: g };
  if (opts.yMax != null && typeof opts.yMax === 'number' && !Number.isNaN(opts.yMax) && opts.yMax > 0) {
    yScale.max = opts.yMax;
  }
  return new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { labels: { color: text, boxWidth: 12, font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: text, font: { size: 10 } }, grid: g },
        y: yScale,
      },
    },
  });
}

function _mkBar(id, labels, datasets) {
  const {grid, text} = _chartColors();
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return null;
  return new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { color: text, font: { size: 10 }, precision: 0 }, grid: { color: grid } },
        y: { ticks: { color: text, font: { size: 10 } }, grid: { color: grid } },
      },
    },
  });
}

/** Vertical bar chart (time categories on X) — for custom trends */
function _mkBarV(id, labels, datasets, opts) {
  opts = opts || {};
  const stacked = !!opts.stacked;
  const {grid, text} = _chartColors();
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return null;
  const yPrec = opts.yPrecision;
  const yTick = { color: text, font: { size: 10 } };
  if (yPrec != null) {
    yTick.precision = yPrec;
    yTick.callback = (v) => (typeof v === 'number' ? v.toFixed(yPrec) : v);
  } else {
    yTick.precision = 0;
  }
  const showGrid = opts.showGrid !== false;
  const g = showGrid ? { color: grid } : { display: false };
  const yBar = { stacked, beginAtZero: true, ticks: yTick, grid: g };
  if (opts.yMax != null && typeof opts.yMax === 'number' && !Number.isNaN(opts.yMax) && opts.yMax > 0) {
    yBar.max = opts.yMax;
  }
  return new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { labels: { color: text, boxWidth: 12, font: { size: 11 } } } },
      scales: {
        x: { stacked, ticks: { color: text, font: { size: 10 } }, grid: g },
        y: yBar,
      },
    },
  });
}

const TREND_CUSTOM_LS = 'cimon-trends-custom';
const TREND_CUSTOM_MAX = 12;
const TREND_CUSTOM_MAX_SERIES = 8;
const TREND_METRICS_RAW = ['builds_total', 'builds_failed', 'builds_ok', 'tests_total', 'tests_failed', 'tests_ok', 'services_down'];
const TREND_METRICS_DERIVED = ['builds_fail_pct', 'tests_fail_pct'];
const TREND_METRICS_JOB = ['job_failed', 'job_total'];
const TREND_METRICS_SVC = ['service_down'];
const TREND_METRICS = TREND_METRICS_RAW.concat(TREND_METRICS_DERIVED).concat(TREND_METRICS_JOB).concat(TREND_METRICS_SVC);

function _trendMetricVal(d, key) {
  if (!d || typeof d !== 'object') return 0;
  switch (key) {
    case 'builds_ok': {
      const bt = typeof d.builds_total === 'number' ? d.builds_total : 0;
      const bf = typeof d.builds_failed === 'number' ? d.builds_failed : 0;
      return Math.max(0, bt - bf);
    }
    case 'tests_ok': {
      const tt = typeof d.tests_total === 'number' ? d.tests_total : 0;
      const tf = typeof d.tests_failed === 'number' ? d.tests_failed : 0;
      return Math.max(0, tt - tf);
    }
    case 'builds_fail_pct': {
      const bt = d.builds_total;
      const bf = d.builds_failed;
      if (typeof bt !== 'number' || bt <= 0 || typeof bf !== 'number') return 0;
      return Math.round((1000 * bf) / bt) / 10;
    }
    case 'tests_fail_pct': {
      const tt = d.tests_total;
      const tf = d.tests_failed;
      if (typeof tt !== 'number' || tt <= 0 || typeof tf !== 'number') return 0;
      return Math.round((1000 * tf) / tt) / 10;
    }
    default: {
      const v = d[key];
      return typeof v === 'number' && !Number.isNaN(v) ? v : 0;
    }
  }
}

function _trendLinePointRadius(p) {
  if (p === 'sm') return { r: 2, h: 3 };
  if (p === 'md') return { r: 4, h: 6 };
  return { r: 0, h: 0 };
}

function _trendMetricIsPct(metric) {
  return String(metric || '').endsWith('_fail_pct');
}

function _jobMapVal(d, mapKey, jobName) {
  if (!d || !jobName || typeof d[mapKey] !== 'object') return 0;
  const v = d[mapKey][jobName];
  return typeof v === 'number' && !Number.isNaN(v) ? v : 0;
}
function _serviceDownVal(d, serviceName) {
  if (!d || !d.service_health || !serviceName) return 0;
  const st = String(d.service_health[serviceName] || '').toLowerCase();
  return st === 'down' ? 1 : 0;
}
function _trendSeriesVal(d, s) {
  if (!d || !s) return 0;
  const m = String(s.metric || '');
  if (m === 'job_failed') return _jobMapVal(d, 'job_failures', s.jobName);
  if (m === 'job_total') return _jobMapVal(d, 'job_totals', s.jobName);
  if (m === 'service_down') return _serviceDownVal(d, s.serviceName);
  return _trendMetricVal(d, m);
}
function _movingAvg(arr, w) {
  if (!w || w < 2 || !Array.isArray(arr)) return arr.slice();
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const a = Math.max(0, i - w + 1);
    const slice = arr.slice(a, i + 1);
    out.push(slice.reduce((x, y) => x + y, 0) / slice.length);
  }
  return out;
}
function _smoothSeries(arr, mode) {
  if (mode === 'ma3') return _movingAvg(arr, 3);
  if (mode === 'ma7') return _movingAvg(arr, 7);
  return arr.slice();
}

function loadCustomTrendsConfig() {
  try {
    const raw = localStorage.getItem(TREND_CUSTOM_LS);
    const a = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(a)) return [];
    const out = [];
    for (const x of a) {
      if (!x || typeof x !== 'object') continue;
      const id = String(x.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!id || id.length > 64) continue;
      const title = typeof x.title === 'string' ? x.title.trim().slice(0, 120) : '';
      if (!title) continue;
      const kind = x.kind === 'bar' ? 'bar' : 'line';
      const lineFill = x.lineFill === false ? false : true;
      const linePoints = ['none', 'sm', 'md'].includes(x.linePoints) ? x.linePoints : 'none';
      const barStacked = !!x.barStacked;
      const chartSmooth = ['none', 'ma3', 'ma7'].includes(x.chartSmooth) ? x.chartSmooth : 'none';
      const hideGrid = !!x.hideGrid;
      const lt = parseFloat(x.lineTension, 10);
      let yMax;
      if (x.yMax != null && x.yMax !== '') {
        const yn = parseFloat(x.yMax, 10);
        if (!Number.isNaN(yn) && yn > 0) yMax = yn;
      }
      const series = (Array.isArray(x.series) ? x.series : [])
        .map((s) => {
          if (!s || !TREND_METRICS.includes(String(s.metric))) return null;
          const m = String(s.metric);
          const lab = (s.label && String(s.label).trim()) ? String(s.label).trim().slice(0, 80) : undefined;
          let colorIdx;
          if (s.colorIdx !== undefined && s.colorIdx !== null && s.colorIdx !== '') {
            const n = parseInt(s.colorIdx, 10);
            if (!Number.isNaN(n) && n >= 0 && n <= 4) colorIdx = n;
          }
          const jobName = (s.jobName && String(s.jobName).trim()) ? String(s.jobName).trim().slice(0, 200) : undefined;
          const serviceName = (s.serviceName && String(s.serviceName).trim()) ? String(s.serviceName).trim().slice(0, 200) : undefined;
          if (TREND_METRICS_JOB.includes(m) && !jobName) return null;
          if (m === 'service_down' && !serviceName) return null;
          const o = { metric: m, label: lab, colorIdx };
          if (jobName) o.jobName = jobName;
          if (serviceName) o.serviceName = serviceName;
          return o;
        })
        .filter(Boolean)
        .slice(0, TREND_CUSTOM_MAX_SERIES);
      if (!series.length) continue;
      const entry = { id, title, kind, lineFill, linePoints, barStacked, series, chartSmooth, hideGrid };
      if (!Number.isNaN(lt) && lt >= 0 && lt <= 1) entry.lineTension = lt;
      if (yMax != null) entry.yMax = yMax;
      out.push(entry);
    }
    return out;
  } catch {
    return [];
  }
}

function saveCustomTrendsConfig(arr) {
  localStorage.setItem(TREND_CUSTOM_LS, JSON.stringify(arr));
}

function tcMetricOptionsHtml(selected) {
  const opt = (m) => {
    const sel = m === selected ? ' selected' : '';
    return `<option value="${m}"${sel}>${esc(t('dash.metric_' + m))}</option>`;
  };
  let h = `<optgroup label="${esc(t('dash.trend_metric_group_raw'))}">`;
  h += TREND_METRICS_RAW.map(opt).join('');
  h += `</optgroup><optgroup label="${esc(t('dash.trend_metric_group_derived'))}">`;
  h += TREND_METRICS_DERIVED.map(opt).join('');
  h += `</optgroup><optgroup label="${esc(t('dash.trend_metric_group_job'))}">`;
  h += TREND_METRICS_JOB.map(opt).join('');
  h += `</optgroup><optgroup label="${esc(t('dash.trend_metric_group_svc'))}">`;
  h += TREND_METRICS_SVC.map(opt).join('');
  h += '</optgroup>';
  return h;
}

function tcColorOptionsHtml(selected) {
  const labels = [
    t('dash.trend_custom_color_auto'),
    t('dash.trend_color_info'),
    t('dash.trend_color_fail'),
    t('dash.trend_color_ok'),
    t('dash.trend_color_warn'),
    t('dash.trend_color_purple'),
  ];
  const values = ['', '0', '1', '2', '3', '4'];
  const selNorm = selected === undefined || selected === null ? '' : String(selected);
  return values.map((val, i) => {
    const sel = selNorm === '' ? (i === 0 ? ' selected' : '') : (selNorm === val ? ' selected' : '');
    return `<option value="${val}"${sel}>${esc(labels[i])}</option>`;
  }).join('');
}

function tcAddSeriesRow() {
  const wrap = document.getElementById('tc-series-rows');
  if (!wrap) return;
  if (wrap.querySelectorAll('.tc-series-row').length >= TREND_CUSTOM_MAX_SERIES) {
    showToast(tf('dash.trend_custom_err_series_max', { n: TREND_CUSTOM_MAX_SERIES }), 'warn');
    return;
  }
  const row = document.createElement('div');
  row.className = 'tc-series-row';
  const prevRow = wrap.querySelector('.tc-series-row:last-child');
  const first = wrap.querySelector('.tc-metric');
  const pick = prevRow && prevRow.querySelector('.tc-metric')?.value ? prevRow.querySelector('.tc-metric').value : (first && first.value ? first.value : TREND_METRICS[0]);
  const colSel = prevRow && prevRow.querySelector('.tc-color');
  const colPick = colSel ? colSel.value : '';
  row.innerHTML = `<select class="tc-metric" onchange="tcRowSyncMetric(this.closest('.tc-series-row'))">${tcMetricOptionsHtml(pick)}</select>
    <input type="text" class="tc-job-input" list="tc-job-datalist" style="display:none;flex:1;min-width:min(100%,200px)" maxlength="200" data-i18n-placeholder="dash.trend_job_ph" placeholder="" />
    <input type="text" class="tc-svc-input" list="tc-svc-datalist" style="display:none;flex:1;min-width:min(100%,200px)" maxlength="200" data-i18n-placeholder="dash.trend_svc_ph" placeholder="" />
    <input type="text" class="tc-label" data-i18n-placeholder="dash.trend_custom_legend_ph" placeholder="" />
    <select class="tc-color" title="">${tcColorOptionsHtml(colPick)}</select>
    <button type="button" class="btn btn-ghost" style="font-size:.75rem;padding:.2rem .45rem" onclick="tcRemoveSeriesRow(this)" data-i18n="dash.trend_custom_remove_row">×</button>`;
  wrap.appendChild(row);
  tcRowSyncMetric(row);
  applyUITexts();
}

function tcRowSyncMetric(row) {
  if (!row) return;
  const met = row.querySelector('.tc-metric')?.value || '';
  const ji = row.querySelector('.tc-job-input');
  const si = row.querySelector('.tc-svc-input');
  if (ji) {
    ji.style.display = TREND_METRICS_JOB.includes(met) ? '' : 'none';
  }
  if (si) {
    si.style.display = met === 'service_down' ? '' : 'none';
  }
}

function tcRemoveSeriesRow(btn) {
  const wrap = document.getElementById('tc-series-rows');
  if (!wrap || wrap.querySelectorAll('.tc-series-row').length < 2) return;
  btn.closest('.tc-series-row')?.remove();
}

function tcEnsureSeriesRows() {
  const wrap = document.getElementById('tc-series-rows');
  if (!wrap) return;
  if (wrap.querySelector('.tc-series-row')) return;
  tcAddSeriesRow();
}

function tcSyncTrendModalKindUI() {
  const k = document.getElementById('tc-kind')?.value;
  const lo = document.getElementById('tc-line-opts');
  const bo = document.getElementById('tc-bar-opts');
  if (lo) lo.style.display = k === 'line' ? '' : 'none';
  if (bo) bo.style.display = k === 'bar' ? '' : 'none';
}

let _trendsModalPrevFocus = null;
function refreshTrendsModalDatalists() {
  const raw = _trendsRawCache || [];
  const jobs = new Set();
  const svcs = new Set();
  raw.forEach((d) => {
    Object.keys(d.job_failures || {}).forEach((j) => jobs.add(j));
    Object.keys(d.job_totals || {}).forEach((j) => jobs.add(j));
    Object.keys(d.service_health || {}).forEach((s) => svcs.add(s));
  });
  const escA = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const jdl = document.getElementById('tc-job-datalist');
  const sdl = document.getElementById('tc-svc-datalist');
  if (jdl) jdl.innerHTML = [...jobs].sort().slice(0, 500).map((j) => `<option value="${escA(j)}"></option>`).join('');
  if (sdl) sdl.innerHTML = [...svcs].sort().slice(0, 500).map((s) => `<option value="${escA(s)}"></option>`).join('');
}

function openTrendsChartModal() {
  const ov = document.getElementById('trends-chart-modal');
  if (!ov) return;
  _trendsModalPrevFocus = document.activeElement;
  resetTrendsConstructorForm();
  refreshTrendsModalDatalists();
  tcSyncTrendModalKindUI();
  ov.setAttribute('aria-hidden', 'false');
  ov.classList.add('open');
  requestAnimationFrame(() => document.getElementById('tc-title')?.focus());
}

function closeTrendsChartModal() {
  const ov = document.getElementById('trends-chart-modal');
  if (!ov) return;
  ov.classList.remove('open');
  ov.setAttribute('aria-hidden', 'true');
  try {
    if (_trendsModalPrevFocus && typeof _trendsModalPrevFocus.focus === 'function') _trendsModalPrevFocus.focus();
  } catch { /* ignore */ }
  _trendsModalPrevFocus = null;
}

function resetTrendsConstructorForm() {
  const ti = document.getElementById('tc-title');
  if (ti) ti.value = '';
  const k = document.getElementById('tc-kind');
  if (k) k.value = 'line';
  const lf = document.getElementById('tc-line-fill');
  if (lf) lf.checked = true;
  const lp = document.getElementById('tc-line-points');
  if (lp) lp.value = 'none';
  const br = document.querySelector('input[name="tc-bar-mode"][value="grouped"]');
  if (br) br.checked = true;
  const cs = document.getElementById('tc-chart-smooth');
  if (cs) cs.value = 'none';
  const ym = document.getElementById('tc-y-max');
  if (ym) ym.value = '';
  const hg = document.getElementById('tc-hide-grid');
  if (hg) hg.checked = false;
  const lt = document.getElementById('tc-line-tension');
  if (lt) lt.value = '0.3';
  const wrap = document.getElementById('tc-series-rows');
  if (wrap) {
    wrap.innerHTML = '';
    tcAddSeriesRow();
  }
}

function addCustomTrendChart() {
  const title = (document.getElementById('tc-title')?.value || '').trim();
  const kind = document.getElementById('tc-kind')?.value === 'bar' ? 'bar' : 'line';
  const lineFill = !!document.getElementById('tc-line-fill')?.checked;
  const linePoints = document.getElementById('tc-line-points')?.value || 'none';
  const barStacked = document.querySelector('input[name="tc-bar-mode"]:checked')?.value === 'stacked';
  const rows = document.querySelectorAll('#tc-series-rows .tc-series-row');
  const series = [];
  for (const row of rows) {
    const met = row.querySelector('.tc-metric')?.value;
    const lab = (row.querySelector('.tc-label')?.value || '').trim();
    const jobName = (row.querySelector('.tc-job-input')?.value || '').trim();
    const serviceName = (row.querySelector('.tc-svc-input')?.value || '').trim();
    const cRaw = row.querySelector('.tc-color')?.value;
    let colorIdx;
    if (cRaw !== undefined && cRaw !== '') {
      const n = parseInt(cRaw, 10);
      if (!Number.isNaN(n) && n >= 0 && n <= 4) colorIdx = n;
    }
    if (!met || !TREND_METRICS.includes(met)) continue;
    if (TREND_METRICS_JOB.includes(met) && !jobName) {
      showToast(t('dash.trend_custom_err_job'), 'warn');
      return;
    }
    if (met === 'service_down' && !serviceName) {
      showToast(t('dash.trend_custom_err_svc'), 'warn');
      return;
    }
    const o = { metric: met, label: lab || undefined };
    if (colorIdx !== undefined) o.colorIdx = colorIdx;
    if (jobName) o.jobName = jobName;
    if (serviceName) o.serviceName = serviceName;
    series.push(o);
  }
  if (!title) {
    showToast(t('dash.trend_custom_err_title'), 'warn');
    return;
  }
  if (!series.length) {
    showToast(t('dash.trend_custom_err_series'), 'warn');
    return;
  }
  const cf = loadCustomTrendsConfig();
  if (cf.length >= TREND_CUSTOM_MAX) {
    showToast(t('dash.trend_custom_max'), 'warn');
    return;
  }
  const chartSmooth = document.getElementById('tc-chart-smooth')?.value || 'none';
  const yMaxRaw = document.getElementById('tc-y-max')?.value;
  let yMax;
  if (yMaxRaw != null && String(yMaxRaw).trim() !== '') {
    const yn = parseFloat(yMaxRaw, 10);
    if (!Number.isNaN(yn) && yn > 0) yMax = yn;
  }
  const hideGrid = !!document.getElementById('tc-hide-grid')?.checked;
  const lineTension = parseFloat(document.getElementById('tc-line-tension')?.value || '0.3', 10);
  const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const entry = { id, title, kind, series, chartSmooth: ['none', 'ma3', 'ma7'].includes(chartSmooth) ? chartSmooth : 'none', hideGrid };
  if (yMax != null) entry.yMax = yMax;
  if (kind === 'line') {
    entry.lineFill = lineFill;
    entry.linePoints = ['none', 'sm', 'md'].includes(linePoints) ? linePoints : 'none';
    if (!Number.isNaN(lineTension) && lineTension >= 0 && lineTension <= 1) entry.lineTension = lineTension;
  }
  if (kind === 'bar') entry.barStacked = barStacked;
  cf.push(entry);
  saveCustomTrendsConfig(cf);
  closeTrendsChartModal();
  if (_trendsRawCache && _trendsRawCache.length) renderTrendsFromCache();
  else loadTrends(_trendsViewDays, null);
}

function removeCustomTrendChart(id) {
  const sid = String(id || '');
  const cf = loadCustomTrendsConfig().filter((c) => c.id !== sid);
  saveCustomTrendsConfig(cf);
  if (_trendsRawCache && _trendsRawCache.length) renderTrendsFromCache();
  else loadTrends(_trendsViewDays, null);
}

function renderCustomTrendChartCards() {
  const wrap = document.getElementById('trends-custom-grid');
  const heading = document.getElementById('trends-custom-heading');
  if (!wrap) return;
  const configs = loadCustomTrendsConfig();
  if (!configs.length) {
    wrap.innerHTML = '';
    if (heading) heading.style.display = 'none';
    return;
  }
  if (heading) heading.style.display = '';
  wrap.innerHTML = configs
    .map((cfg) => {
      const sid = String(cfg.id);
      const stitle = esc(cfg.title);
      return `<div class="chart-card chart-card-custom" id="chart-card-custom-${sid}">
      <button type="button" class="chart-zoom-btn" onclick="toggleChartFullscreen('chart-card-custom-${sid}',-1)" data-i18n-title="dash.zoom_chart" title="">&#x2922;</button>
      <button type="button" class="chart-del-btn" onclick="removeCustomTrendChart('${sid}')" data-i18n-title="dash.trend_custom_remove_chart" title="">&#10005;</button>
      <h3>${stitle}</h3>
      <canvas id="chart-custom-${sid}"></canvas>
    </div>`;
    })
    .join('');
  applyUITexts();
}

function buildCustomTrendCharts(data, labels) {
  const palette = ['--info', '--st-failure', '--st-success', '--warn', '--purple'];
  const out = [];
  loadCustomTrendsConfig().forEach((cfg) => {
    const cid = 'chart-custom-' + cfg.id;
    const anyPct = cfg.series.some((s) => _trendMetricIsPct(s.metric));
    const yPrecision = anyPct ? 1 : 0;
    const lineFill = cfg.lineFill !== false;
    const linePts = _trendLinePointRadius(cfg.linePoints || 'none');
    const lt = parseFloat(cfg.lineTension, 10);
    const tension = cfg.kind === 'line' && !Number.isNaN(lt) && lt >= 0 && lt <= 1 ? lt : 0.3;
    const sm = cfg.chartSmooth || 'none';
    const hideGrid = !!cfg.hideGrid;
    const yMax = cfg.yMax;
    const datasets = cfg.series.map((s, i) => {
      const pi = typeof s.colorIdx === 'number' && s.colorIdx >= 0 && s.colorIdx <= 4 ? s.colorIdx : (i % palette.length);
      const col = _cssVar(palette[pi]);
      let defLabel = t('dash.metric_' + s.metric);
      if (TREND_METRICS_JOB.includes(s.metric) && s.jobName) defLabel = `${defLabel}: ${s.jobName}`;
      if (s.metric === 'service_down' && s.serviceName) defLabel = `${defLabel}: ${s.serviceName}`;
      const label = (s.label && s.label.trim()) ? s.label.trim() : defLabel;
      let vals = data.map((d) => _trendSeriesVal(d, s));
      if (sm === 'ma3') vals = _movingAvg(vals, 3);
      else if (sm === 'ma7') vals = _movingAvg(vals, 7);
      const base = {
        label,
        data: vals,
        borderColor: col,
        backgroundColor: cfg.kind === 'bar' ? _hexToRgba(col, 0.55) : _hexToRgba(col, 0.12),
        tension: cfg.kind === 'line' ? tension : 0,
        fill: cfg.kind === 'line' && lineFill,
      };
      if (cfg.kind === 'bar') base.borderWidth = 1;
      if (cfg.kind === 'line') {
        base.pointRadius = linePts.r;
        base.pointHoverRadius = linePts.h;
      }
      return base;
    });
    const chartOpts = { yPrecision, showGrid: !hideGrid, yMax };
    let ch;
    if (cfg.kind === 'bar') {
      ch = _mkBarV(cid, labels, datasets, { stacked: !!cfg.barStacked, yPrecision, showGrid: !hideGrid, yMax });
    } else {
      ch = _mkLine(cid, labels, datasets, chartOpts);
    }
    if (ch) out.push(ch);
    const node = document.getElementById(cid);
    if (node) {
      node.setAttribute('role', 'img');
      node.setAttribute('aria-label', cfg.title);
    }
  });
  return out;
}

function setTrendsSize(size, btn) {
  const wrap = document.getElementById('wrap-trends');
  if (!wrap) return;
  wrap.setAttribute('data-size', size);
  document.querySelectorAll('.trends-size-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  localStorage.setItem('cimon-trends-size', size);
  requestAnimationFrame(() => _trendsCharts.forEach(c => c && c.resize()));
}

function toggleChartFullscreen(cardId, chartIndex) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const wasFs = card.classList.contains('chart-fs');
  document.querySelectorAll('.chart-card.chart-fs').forEach(c => c.classList.remove('chart-fs'));
  if (!wasFs) card.classList.add('chart-fs');
  requestAnimationFrame(() => {
    _trendsCharts.forEach(c => c && c.resize());
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.querySelector('.chart-card.chart-fs')) {
    document.querySelectorAll('.chart-card.chart-fs').forEach(c => c.classList.remove('chart-fs'));
    requestAnimationFrame(() => _trendsCharts.forEach(c => c && c.resize()));
  }
});

function getTrendsViewData() {
  const raw = _trendsRawCache;
  if (!raw || !raw.length) return [];
  let view = raw;
  if (_trendsRangeActive && _trendsRangeFrom && _trendsRangeTo && _trendsRangeFrom <= _trendsRangeTo) {
    view = view.filter((d) => d.date >= _trendsRangeFrom && d.date <= _trendsRangeTo);
  } else {
    const n = Math.min(_trendsViewDays, view.length);
    view = view.slice(-n);
  }

  const src = (_trendsSource || '').trim().toLowerCase();
  if (!src) return view;

  // Override totals used by default charts using per-source breakdowns (if present in history).
  return view.map((e) => {
    const be = (e && typeof e === 'object') ? e : {};
    const bsrc = (be.builds_by_source && be.builds_by_source[src]) ? be.builds_by_source[src] : null;
    const tsrc = (be.tests_by_source && be.tests_by_source[src]) ? be.tests_by_source[src] : null;
    const topBySrc = (be.top_test_failures_by_source && be.top_test_failures_by_source[src])
      ? be.top_test_failures_by_source[src]
      : null;
    return {
      ...be,
      builds_total: bsrc && typeof bsrc.total === 'number' ? bsrc.total : be.builds_total,
      builds_failed: bsrc && typeof bsrc.failed === 'number' ? bsrc.failed : be.builds_failed,
      tests_total: tsrc && typeof tsrc.total === 'number' ? tsrc.total : be.tests_total,
      tests_failed: tsrc && typeof tsrc.failed === 'number' ? tsrc.failed : be.tests_failed,
      top_test_failures: Array.isArray(topBySrc) ? topBySrc : be.top_test_failures,
    };
  });
}

function renderTrendsFromCache() {
  renderTrendsChartsFromData(getTrendsViewData());
}

function onTrendsSmoothChange(el) {
  _trendsSmooth = el && el.value ? el.value : 'none';
  localStorage.setItem('cimon-trends-smooth', _trendsSmooth);
  if (_trendsRawCache && _trendsRawCache.length) renderTrendsFromCache();
}

function onTrendsTopNChange(el) {
  let n = parseInt(el && el.value, 10);
  if (!Number.isFinite(n)) n = 10;
  n = Math.min(100, Math.max(3, n));
  _trendsTopN = n;
  if (el && 'value' in el) el.value = String(n);
  try { localStorage.setItem('cimon-trends-topn', String(_trendsTopN)); } catch { /* ignore */ }
  if (_trendsRawCache && _trendsRawCache.length) renderTrendsFromCache();
}

function onTrendsSourceChange(el) {
  _trendsSource = el && typeof el.value === 'string' ? el.value.trim().toLowerCase() : '';
  try { localStorage.setItem('cimon-trends-source', _trendsSource); } catch { /* ignore */ }
  if (_trendsRawCache && _trendsRawCache.length) renderTrendsFromCache();
}

function applyTrendsDateRange() {
  const _norm = (v) => {
    const s = String(v || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // Accept RU-style manual input too (dd.mm.yyyy) — some browsers keep the dots.
    const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return '';
  };
  const df = _norm(document.getElementById('trends-d-from')?.value);
  const dt = _norm(document.getElementById('trends-d-to')?.value);
  if (!df || !dt || df > dt) {
    showToast(t('dash.trends_range_invalid'), 'warn');
    return;
  }
  _trendsRangeFrom = df;
  _trendsRangeTo = dt;
  _trendsRangeActive = true;
  localStorage.setItem('cimon-trends-rfrom', df);
  localStorage.setItem('cimon-trends-rto', dt);
  document.querySelectorAll('.trend-period-btn').forEach((b) => b.classList.remove('active'));
  void loadTrends(_trendsViewDays, null);
}

function clearTrendsDateRange() {
  _trendsRangeActive = false;
  _trendsRangeFrom = '';
  _trendsRangeTo = '';
  localStorage.removeItem('cimon-trends-rfrom');
  localStorage.removeItem('cimon-trends-rto');
  const df = document.getElementById('trends-d-from');
  const dt = document.getElementById('trends-d-to');
  if (df) df.value = '';
  if (dt) dt.value = '';
  document.querySelectorAll('.trend-period-btn').forEach((b) => {
    const d = parseInt(b.textContent.trim(), 10);
    b.classList.toggle('active', d === _trendsViewDays);
  });
  if (_trendsRawCache && _trendsRawCache.length) renderTrendsFromCache();
}

window.applyTrendsDateRange = applyTrendsDateRange;
window.clearTrendsDateRange = clearTrendsDateRange;

function initTrendsFiltersFromStorage() {
  const tsm = localStorage.getItem('cimon-trends-smooth');
  if (['none', 'ma3', 'ma7'].includes(tsm)) _trendsSmooth = tsm;
  const elSm = document.getElementById('trends-smooth');
  if (elSm) elSm.value = _trendsSmooth;
  const tsrc = (localStorage.getItem('cimon-trends-source') || '').trim().toLowerCase();
  if (tsrc) _trendsSource = tsrc;
  const elSrc = document.getElementById('trends-source');
  if (elSrc) elSrc.value = _trendsSource;
  const ttn = parseInt(localStorage.getItem('cimon-trends-topn'), 10);
  if (Number.isFinite(ttn) && ttn >= 3 && ttn <= 100) _trendsTopN = ttn;
  const elTn = document.getElementById('trends-topn');
  if (elTn && 'value' in elTn) elTn.value = String(_trendsTopN);
  const elSvKind = document.getElementById('trends-inst-svcs');
  const tsk = (localStorage.getItem('cimon-trends-inst-svcs') || '').trim();
  if (elSvKind && ['', 'docker', 'http', 'other'].includes(tsk)) elSvKind.value = tsk;
  const tp = parseInt(localStorage.getItem('cimon-trends-period'), 10);
  if ([3, 7, 14, 21, 30].includes(tp)) _trendsViewDays = tp;
  const rf = localStorage.getItem('cimon-trends-rfrom');
  const rt = localStorage.getItem('cimon-trends-rto');
  if (rf && rt && rf <= rt) {
    _trendsRangeFrom = rf;
    _trendsRangeTo = rt;
    _trendsRangeActive = true;
    const df = document.getElementById('trends-d-from');
    const dtt = document.getElementById('trends-d-to');
    if (df) df.value = rf;
    if (dtt) dtt.value = rt;
  }
  document.querySelectorAll('.trend-period-btn').forEach((b) => {
    const d = parseInt(b.textContent.trim(), 10);
    b.classList.toggle('active', d === _trendsViewDays && !_trendsRangeActive);
  });
}

function renderTrendsChartsFromData(data) {
  _destroyCharts();
  renderCustomTrendChartCards();
  if (!data.length) {
    document.querySelectorAll('#panel-trends canvas').forEach((c) => {
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.font = '13px system-ui';
      ctx.fillText(t('dash.trends_empty'), c.width / 2, 80);
    });
    return;
  }
  const labels = data.map((d) => d.date);
  const sm = _trendsSmooth;
  const sl = (arr) => _smoothSeries(arr, sm);
  const cInfo = _cssVar('--info');
  const cFail = _cssVar('--st-failure');
  const cOk = _cssVar('--st-success');

  const getInstVal = (id) => (document.getElementById(id)?.value || '').trim();
  const instBuilds = getInstVal('trends-inst-builds');
  const instTests = getInstVal('trends-inst-tests');
  const instTop = getInstVal('trends-inst-top');

  const buildTotals = data.map((d) => {
    if (!instBuilds) return d.builds_total;
    const m = d.builds_by_instance && d.builds_by_instance[instBuilds];
    return m && typeof m.total === 'number' ? m.total : d.builds_total;
  });
  const buildFails = data.map((d) => {
    if (!instBuilds) return d.builds_failed;
    const m = d.builds_by_instance && d.builds_by_instance[instBuilds];
    return m && typeof m.failed === 'number' ? m.failed : d.builds_failed;
  });
  const cBuilds = _mkLine('chart-builds', labels, [
    { label: t('dash.chart_total'), data: sl(buildTotals), borderColor: cInfo, backgroundColor: _hexToRgba(cInfo, 0.12), tension: 0.3, fill: true },
    { label: t('dash.chart_failed'), data: sl(buildFails), borderColor: cFail, backgroundColor: _hexToRgba(cFail, 0.12), tension: 0.3, fill: true },
  ]);

  const instToTestSrc = (v) => (v.startsWith('jenkins|') ? 'jenkins' : v.startsWith('gitlab|') ? 'gitlab' : '');
  const wantTestSrc = instToTestSrc(instTests);
  const testTotalsLine = data.map((d) => {
    if (!wantTestSrc) return d.tests_total;
    const m = d.tests_by_source && d.tests_by_source[wantTestSrc];
    return m && typeof m.total === 'number' ? m.total : d.tests_total;
  });
  const testFailsLine = data.map((d) => {
    if (!wantTestSrc) return d.tests_failed;
    const m = d.tests_by_source && d.tests_by_source[wantTestSrc];
    return m && typeof m.failed === 'number' ? m.failed : d.tests_failed;
  });
  const cTests = _mkLine('chart-tests', labels, [
    { label: t('dash.chart_total'), data: sl(testTotalsLine), borderColor: cOk, backgroundColor: _hexToRgba(cOk, 0.12), tension: 0.3, fill: true },
    { label: t('dash.chart_failed'), data: sl(testFailsLine), borderColor: cFail, backgroundColor: _hexToRgba(cFail, 0.12), tension: 0.3, fill: true },
  ]);

  const svcsKind = (document.getElementById('trends-inst-svcs')?.value || '').trim();
  const svcDownSeries = data.map((d) => {
    if (!svcsKind) return d.services_down;
    const bk = d.services_down_by_kind;
    if (bk && typeof bk[svcsKind] === 'number') return bk[svcsKind];
    return 0;
  });
  const cSvcs = _mkLine('chart-svcs', labels, [
    { label: t('dash.chart_down'), data: sl(svcDownSeries), borderColor: cFail, backgroundColor: _hexToRgba(cFail, 0.2), tension: 0.3, fill: true },
  ]);

  const wantTopSrc = instToTestSrc(instTop);
  const testTotals = {};
  data.forEach((d) => {
    const arr = wantTopSrc && d.top_test_failures_by_source && Array.isArray(d.top_test_failures_by_source[wantTopSrc])
      ? d.top_test_failures_by_source[wantTopSrc]
      : (d.top_test_failures || []);
    (arr || []).forEach(([n, c]) => { testTotals[n] = (testTotals[n] || 0) + c; });
  });
  const topN = Math.min(100, Math.max(3, parseInt(String(_trendsTopN), 10) || 10));
  const topSlice = Object.entries(testTotals).sort((a, b) => b[1] - a[1]).slice(0, topN);
  const cTop = topSlice.length ? _mkBar('chart-top-tests',
    topSlice.map(([n]) => (n.length > 35 ? n.slice(0, 35) + '…' : n)),
    [{ label: t('dash.chart_failures'), data: topSlice.map(([, c]) => c), backgroundColor: _hexToRgba(cFail, 0.7), borderColor: cFail, borderWidth: 1 }]
  ) : null;

  const customCharts = buildCustomTrendCharts(data, labels);
  _trendsCharts = [cBuilds, cTests, cSvcs, cTop, ...customCharts].filter(Boolean);
  [
    ['chart-builds', 'dash.chart_builds'],
    ['chart-tests', 'dash.chart_tests'],
    ['chart-svcs', 'dash.chart_svcs'],
    ['chart-top-tests', 'dash.chart_top'],
  ].forEach(([cid, tkey]) => {
    const node = document.getElementById(cid);
    if (!node) return;
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', t(tkey));
  });
}

function _utcIsoDate() {
  const n = new Date();
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-${String(n.getUTCDate()).padStart(2, '0')}`;
}

/** Inclusive calendar span between two YYYY-MM-DD strings (UTC noon; matches backend trend day_key). */
function _isoYmdInclusiveSpan(a, b) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(b))) return 0;
  const t0 = Date.parse(`${a}T12:00:00.000Z`);
  const t1 = Date.parse(`${b}T12:00:00.000Z`);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return 0;
  return Math.floor((t1 - t0) / 864e5) + 1;
}

/** `days` for /api/trends: cover preset window and custom range start (server uses UTC dates). */
function _trendsApiDaysFetch() {
  const preset = Math.min(730, Math.max(30, Number(_trendsViewDays) || 14));
  let n = preset;
  if (_trendsRangeActive && _trendsRangeFrom && _trendsRangeTo && _trendsRangeFrom <= _trendsRangeTo) {
    const todayUtc = _utcIsoDate();
    const needBack = _isoYmdInclusiveSpan(_trendsRangeFrom, todayUtc);
    n = Math.min(730, Math.max(n, needBack));
  }
  return n;
}

async function loadTrends(days, btn) {
  if (typeof days === 'number') _trendsViewDays = days;
  if (btn) {
    document.querySelectorAll('.trend-period-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    _trendsRangeActive = false;
    const df = document.getElementById('trends-d-from');
    const dt = document.getElementById('trends-d-to');
    if (df) df.value = '';
    if (dt) dt.value = '';
    localStorage.removeItem('cimon-trends-rfrom');
    localStorage.removeItem('cimon-trends-rto');
    localStorage.setItem('cimon-trends-period', String(days));
  }

  const errEl = document.getElementById('trends-error');
  let data;
  try {
    const nd = _trendsApiDaysFetch();
    const res = await fetchKeyed('trends', apiUrl(`api/trends?days=${nd}`)).catch(() => null);
    if (res === FETCH_ABORTED) return;
    if (!res || !res.ok) {
      if (errEl) {
        errEl.style.display = 'flex';
        errEl.innerHTML = `<span>${esc(t('trends_err'))} (HTTP ${res ? res.status : '—'})</span><button type="button" class="btn btn-ghost" onclick="loadTrends(${_trendsViewDays},null)">${t('common.retry')}</button>`;
      }
      return;
    }
    data = await res.json();
  } catch (e) {
    if (errEl) {
      errEl.style.display = 'flex';
      errEl.innerHTML = `<span>${esc(t('trends_err'))}</span><button type="button" class="btn btn-ghost" onclick="loadTrends(${_trendsViewDays},null)">${t('common.retry')}</button>`;
    }
    return;
  }
  _trendsRawCache = Array.isArray(data) ? data : [];
  if (errEl) {
    errEl.style.display = 'none';
    errEl.innerHTML = '';
  }
  renderTrendsChartsFromData(getTrendsViewData());
}

