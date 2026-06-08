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
let _trendsTopTestSource = '';
let _trendsInstSel = { builds: '', tests: '', top: '' };
let _trendsInstanceAll = '';

function _scopeStore() {
  return (window.TrendsScope && typeof window.TrendsScope === 'object') ? window.TrendsScope : null;
}

function _filtersAdapter() {
  return (window.TrendsFiltersAdapter && typeof window.TrendsFiltersAdapter === 'object')
    ? window.TrendsFiltersAdapter
    : null;
}

function _isTrendsScopeGlobalEnabled() {
  const cb = document.getElementById('trends-scope-global');
  return !!(cb && cb.checked);
}

function _syncTrendsScopeToGlobalIfEnabled() {
  if (!_isTrendsScopeGlobalEnabled()) return;
  const ad = _filtersAdapter();
  if (!ad || typeof ad.applyScopeToGlobalFilters !== 'function') return;
  const s = _effectiveTrendScope();
  ad.applyScopeToGlobalFilters(s.source, s.instance);
}

function _activeTrendsSource() {
  const st = _scopeStore();
  if (st && typeof st.effectiveScope === 'function') return String(st.effectiveScope().source || '');
  return (_trendsSource || '').trim().toLowerCase();
}

function _activeTrendsInstance() {
  const st = _scopeStore();
  if (st && typeof st.effectiveScope === 'function') return String(st.effectiveScope().instance || '');
  const globalInst = (_trendsInstanceAll || '').trim();
  if (globalInst) return globalInst;
  const pick = (id) => (document.getElementById(id)?.value || '').trim();
  // If user changes instance in local Trends blocks, KPI cards should follow too.
  return pick('trends-inst-top') || pick('trends-inst-builds') || pick('trends-inst-tests') || '';
}

function _sourceFromInstanceKey(v) {
  const s = String(v || '').trim();
  if (!s.includes('|')) return '';
  return s.split('|', 1)[0].trim().toLowerCase();
}

function _effectiveTrendScope() {
  const instance = _activeTrendsInstance();
  const srcFromInst = _sourceFromInstanceKey(instance);
  const source = (_activeTrendsSource() || srcFromInst || '').trim().toLowerCase();
  return { source, instance };
}

function _renderTrendsKpiHealth(meta) {
  const scopeEl = document.getElementById('tr-kpi-scope');
  const covEl = document.getElementById('tr-kpi-coverage');
  if (!scopeEl || !covEl) return;
  const src = String(meta?.scope_source || '').trim();
  const inst = String(meta?.scope_instance || '').trim();
  const cov = Number(meta?.data_coverage_pct || 0);
  const matched = Number(meta?.days_matched || 0);
  const total = Number(meta?.days_with_data || 0);
  if (inst) {
    scopeEl.textContent = tf('dash.trend_kpi_scope_instance', { value: inst });
  } else if (src) {
    scopeEl.textContent = tf('dash.trend_kpi_scope_source', { value: src });
  } else {
    scopeEl.textContent = t('dash.trend_kpi_scope_default');
  }
  covEl.textContent = tf('dash.trend_kpi_coverage_fmt', {
    pct: Number.isFinite(cov) ? cov.toFixed(1) : '0.0',
    matched: Number.isFinite(matched) ? matched : 0,
    total: Number.isFinite(total) ? total : 0,
  });
}

function _pulseKpiCards() {
  document.querySelectorAll('#trends-history-kpis .tr-kpi-card').forEach((el) => {
    el.classList.remove('tr-kpi-updated');
    void el.offsetWidth;
    el.classList.add('tr-kpi-updated');
  });
}

async function loadTrendsHistorySummary(days) {
  const crashEl = document.getElementById('tr-kpi-crash');
  const recEl = document.getElementById('tr-kpi-recovery');
  const recSubEl = document.getElementById('tr-kpi-recovery-sub');
  const jobsEl = document.getElementById('tr-kpi-jobs');
  if (!crashEl || !recEl || !jobsEl) return;
  try {
    const scope = _effectiveTrendScope();
    const src = encodeURIComponent(scope.source);
    const inst = encodeURIComponent(scope.instance);
    const res = await fetch(apiUrl(`api/trends/history-summary?days=${days}&source=${src}&instance=${inst}`)).catch(() => null);
    if (!res || !res.ok) return;
    const p = await res.json();
    const crash = typeof p.crash_frequency_per_day === 'number' ? p.crash_frequency_per_day : null;
    crashEl.textContent = crash == null ? '—' : `${crash.toFixed(2)}`;

    const avgRec = typeof p.avg_recovery_minutes === 'number' ? p.avg_recovery_minutes : null;
    recEl.textContent = avgRec == null ? '—' : `${avgRec.toFixed(1)}m`;
    const samples = Number.isFinite(Number(p.recovery_samples)) ? Number(p.recovery_samples) : 0;
    if (recSubEl) {
      recSubEl.textContent = samples > 0
        ? tf('dash.trend_kpi_recovery_samples', { n: samples })
        : t('dash.trend_kpi_recovery_none');
    }

    const jobs = Array.isArray(p.most_problematic_jobs) ? p.most_problematic_jobs : [];
    if (!jobs.length) {
      jobsEl.innerHTML = `<div class="tr-kpi-sub">${esc(t('dash.trend_kpi_problem_jobs_none'))}</div><div class="tr-kpi-sub">${esc(t('dash.trend_kpi_problem_jobs_why_empty'))}</div>`;
      _renderTrendsKpiHealth(p);
      _pulseKpiCards();
      return;
    }
    jobsEl.innerHTML = jobs
      .slice(0, 5)
      .map((j) => {
        const name = esc(j.job_name || '—');
        const failed = Number.isFinite(Number(j.failed)) ? Number(j.failed) : 0;
        const total = Number.isFinite(Number(j.total)) ? Number(j.total) : 0;
        const pct = Number.isFinite(Number(j.fail_rate_pct)) ? Number(j.fail_rate_pct).toFixed(1) : '0.0';
        return `<div class="tr-kpi-job"><span>${name}</span><span class="muted">${failed}/${total} (${pct}%)</span></div>`;
      })
      .join('');
    _renderTrendsKpiHealth(p);
    _pulseKpiCards();
  } catch {
    // Keep existing placeholders on failure.
  }
}

async function populateTrendsInstanceFilters() {
  const ids = {
    all: 'trends-instance-all',
    builds: 'trends-inst-builds',
    tests: 'trends-inst-tests',
    top: 'trends-inst-top',
  };
  let items = [];
  try {
    const res = await fetch(apiUrl('api/instances')).catch(() => null);
    if (res && res.ok) items = (await res.json()) || [];
  } catch { /* ignore */ }

  const allInstancesLabel = (typeof t === 'function') ? t('dash.collect_logs_all_instances') : 'All instances';
  const opts = [{ value: '', label: allInstancesLabel }];
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
      if (k === 'all') {
        _trendsInstanceAll = (sel.value || '').trim();
        const st = _scopeStore();
        if (st && typeof st.setInstanceAll === 'function') st.setInstanceAll(_trendsInstanceAll);
        const srcFromInst = _sourceFromInstanceKey(_trendsInstanceAll);
        if (srcFromInst) {
          _trendsSource = srcFromInst;
          if (st && typeof st.setSource === 'function') st.setSource(srcFromInst);
          const srcEl = document.getElementById('trends-source');
          if (srcEl) srcEl.value = srcFromInst;
          try { localStorage.setItem('cimon-trends-source', _trendsSource); } catch { /* ignore */ }
        }
        ['builds', 'tests', 'top'].forEach((sub) => {
          const child = document.getElementById(ids[sub]);
          if (!child) return;
          if (_trendsInstanceAll && opts.some((o) => o.value === _trendsInstanceAll)) child.value = _trendsInstanceAll;
          try { localStorage.setItem('cimon-trends-inst-' + sub, child.value || ''); } catch { /* ignore */ }
        });
      } else if (!_trendsInstanceAll) {
        _trendsInstSel[k] = (sel.value || '').trim();
        const st = _scopeStore();
        if (st && typeof st.setInstanceLocal === 'function') st.setInstanceLocal(k, _trendsInstSel[k]);
        const srcFromLocal = _sourceFromInstanceKey(_trendsInstSel[k]);
        if (srcFromLocal) {
          _trendsSource = srcFromLocal;
          if (st && typeof st.setSource === 'function') st.setSource(srcFromLocal);
          const srcEl = document.getElementById('trends-source');
          if (srcEl) srcEl.value = srcFromLocal;
          try { localStorage.setItem('cimon-trends-source', _trendsSource); } catch { /* ignore */ }
        }
      }
      if (_trendsRawCache && _trendsRawCache.length) {
        _syncTrendsScopeToGlobalIfEnabled();
        renderTrendsFromCache();
        void loadTrendsHistorySummary(_trendsViewDays);
      }
    }, { passive: true });
  });
}

function _chartColors() {
  const light = document.documentElement.classList.contains('light');
  return {
    grid: light ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.07)',
    text: _cssVar('--muted') || (light ? '#64748b' : '#94a3b8'),
  };
}

function _trendTealColor() {
  const v = _cssVar('--chart-teal') || _cssVar('--trend-teal');
  return v && v !== '#94a3b8' ? v : '#14b8a6';
}

const _MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function _formatTrendDateLabel(iso) {
  const s = String(iso || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  const lang = (typeof currentLang === 'function' ? currentLang() : 'en') || 'en';
  if (lang === 'ru') return `${m[3]}.${m[2]}`;
  const mi = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  if (mi < 0 || mi > 11) return s;
  return `${_MONTH_SHORT[mi]} ${day}`;
}

const _trendDataLabelsPlugin = {
  id: 'trendDataLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    chart.data.datasets.forEach((dataset, di) => {
      if (dataset._hideDataLabels) return;
      const meta = chart.getDatasetMeta(di);
      if (!meta || meta.hidden) return;
      const isLine = dataset.type === 'line';
      const isFailBar = dataset._labelRole === 'failed';
      const isValueBar = dataset._labelRole === 'value';
      meta.data.forEach((el, idx) => {
        const val = dataset.data[idx];
        if (val == null || val === 0) return;
        if (!isLine && !isFailBar && !isValueBar) return;
        const txt = typeof val === 'number'
          ? (Number.isInteger(val) ? String(val) : val.toFixed(1))
          : String(val);
        ctx.save();
        if (isLine) {
          ctx.fillStyle = '#f8fafc';
          ctx.font = 'bold 11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(txt, el.x, el.y - 10);
        } else {
          ctx.fillStyle = dataset._labelColor || dataset.backgroundColor || '#94a3b8';
          ctx.font = '600 9px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(txt, el.x, el.y - 3);
        }
        ctx.restore();
      });
    });
  },
};

function _destroyCharts() {
  _trendsCharts.forEach(c => c && c.destroy());
  _trendsCharts = [];
}

function _trendsCollectGraceActive() {
  try {
    if (typeof _collectGraceActive === 'function') return _collectGraceActive();
  } catch { /* ignore */ }
  return typeof _dashIsCollecting !== 'undefined' && !!_dashIsCollecting;
}

function shouldSkipTrendsReloadDuringCollect() {
  try {
    if (typeof isCollectIncrementalRefresh === 'function' && isCollectIncrementalRefresh()) return false;
    if (!_trendsCollectGraceActive()) return false;
    if (typeof _dashTab !== 'undefined' && _dashTab !== 'trends') return false;
    return Array.isArray(_trendsRawCache) && _trendsRawCache.length > 0;
  } catch { return false; }
}

function _setTrendsLoading(on) {
  const wrap = document.getElementById('wrap-trends');
  const banner = document.getElementById('trends-loading');
  const panel = document.getElementById('tab-panel-trends');
  if (banner) {
    banner.hidden = !on;
    banner.classList.toggle('is-visible', !!on);
    if (on && typeof t === 'function') {
      const txt = document.getElementById('trends-loading-txt');
      if (txt) txt.textContent = t('dash.trends_loading');
    }
  }
  if (wrap) wrap.classList.toggle('trends-loading', !!on);
  if (panel) panel.classList.toggle('trends-panel-busy', !!on);
}

function _showTrendsEmptyState(msg) {
  _destroyCharts();
  const text = msg || (typeof t === 'function' ? t('dash.trends_empty') : 'No trend data');
  document.querySelectorAll('#panel-trends .chart-card').forEach((card) => {
    let ph = card.querySelector('.trends-empty-placeholder');
    const canvas = card.querySelector('canvas');
    if (!ph) {
      ph = document.createElement('div');
      ph.className = 'trends-empty-placeholder';
      if (canvas && canvas.parentNode) canvas.parentNode.insertBefore(ph, canvas.nextSibling);
      else card.appendChild(ph);
    }
    ph.textContent = text;
    ph.hidden = false;
    if (canvas) canvas.hidden = true;
  });
}

function _hideTrendsEmptyPlaceholders() {
  document.querySelectorAll('#panel-trends .trends-empty-placeholder').forEach((el) => {
    el.hidden = true;
  });
  document.querySelectorAll('#panel-trends canvas').forEach((c) => { c.hidden = false; });
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

/** Bar + line combo chart (mockup style) */
function _mkComboBarLine(id, labels, totalData, failData, opts) {
  opts = opts || {};
  const { grid, text } = _chartColors();
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return null;
  const cTeal = opts.totalColor || _trendTealColor();
  const cFail = opts.failColor || _cssVar('--st-failure');
  const totalLabel = opts.totalLabel || t('dash.chart_total');
  const failLabel = opts.failLabel || t('dash.chart_failed');
  const yTitle = opts.yTitle || '';
  const g = { color: grid, drawBorder: false, borderDash: [4, 4] };
  const yScale = {
    beginAtZero: true,
    ticks: { color: text, font: { size: 10 }, precision: 0 },
    grid: g,
  };
  if (opts.yMax != null && typeof opts.yMax === 'number' && !Number.isNaN(opts.yMax) && opts.yMax > 0) {
    yScale.max = opts.yMax;
  }
  if (yTitle) {
    yScale.title = { display: true, text: yTitle, color: text, font: { size: 10, weight: '600' } };
  }
  return new Chart(ctx, {
    type: 'bar',
    plugins: [_trendDataLabelsPlugin],
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: totalLabel,
          data: totalData,
          backgroundColor: cTeal,
          borderRadius: 4,
          borderSkipped: false,
          barPercentage: 0.55,
          categoryPercentage: 0.72,
          maxBarThickness: 42,
          order: 2,
        },
        {
          type: 'bar',
          label: failLabel,
          data: failData,
          backgroundColor: cFail,
          borderRadius: 4,
          borderSkipped: false,
          barPercentage: 0.35,
          categoryPercentage: 0.72,
          maxBarThickness: 18,
          order: 3,
          _labelRole: 'failed',
          _labelColor: cFail,
        },
        {
          type: 'line',
          label: totalLabel,
          data: totalData,
          borderColor: cTeal,
          backgroundColor: 'transparent',
          pointRadius: 5,
          pointHoverRadius: 6,
          pointBackgroundColor: cTeal,
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          borderWidth: 2,
          tension: 0.1,
          fill: false,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
          align: 'center',
          labels: {
            color: text,
            boxWidth: 12,
            font: { size: 11 },
            filter: (item, chartData) => chartData.datasets[item.datasetIndex].type !== 'line',
          },
        },
      },
      scales: {
        x: {
          ticks: { color: text, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
          grid: { display: false },
        },
        y: yScale,
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

/** Custom trend chart — same combo bar+line look as default Builds/Tests cards. */
function _mkCustomTrendChart(id, labels, seriesList, opts) {
  opts = opts || {};
  const { grid, text } = _chartColors();
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx || !seriesList.length) return null;
  const kind = opts.kind === 'bar' ? 'bar' : 'line';
  const stacked = !!opts.stacked;
  const showGrid = opts.showGrid !== false;
  const g = showGrid ? { color: grid, drawBorder: false, borderDash: [4, 4] } : { display: false };
  const yPrec = opts.yPrecision;
  const yTick = { color: text, font: { size: 10 } };
  if (yPrec != null) {
    yTick.precision = yPrec;
    yTick.callback = (v) => (typeof v === 'number' ? v.toFixed(yPrec) : v);
  } else {
    yTick.precision = 0;
  }
  const yScale = {
    stacked: kind === 'bar' && stacked,
    beginAtZero: true,
    ticks: yTick,
    grid: g,
  };
  if (opts.yMax != null && typeof opts.yMax === 'number' && !Number.isNaN(opts.yMax) && opts.yMax > 0) {
    yScale.max = opts.yMax;
  }

  const n = seriesList.length;
  const barPct = n <= 1 ? 0.55 : (stacked ? 0.72 : 0.42);
  const datasets = [];

  seriesList.forEach((s, i) => {
    const col = s.color;
    if (kind === 'line') {
      datasets.push({
        type: 'bar',
        label: s.label,
        data: s.data,
        backgroundColor: col,
        borderRadius: 4,
        borderSkipped: false,
        barPercentage: barPct,
        categoryPercentage: 0.72,
        maxBarThickness: n <= 1 ? 42 : 30,
        order: 10 + i,
        _hideDataLabels: true,
      });
      const ptR = s.pointRadius != null ? s.pointRadius : 5;
      datasets.push({
        type: 'line',
        label: s.label,
        data: s.data,
        borderColor: col,
        backgroundColor: 'transparent',
        pointRadius: ptR,
        pointHoverRadius: ptR > 0 ? ptR + 1 : 0,
        pointBackgroundColor: col,
        pointBorderColor: '#fff',
        pointBorderWidth: ptR > 0 ? 2 : 0,
        borderWidth: 2,
        tension: s.tension != null ? s.tension : 0.1,
        fill: false,
        order: 1 + i,
      });
    } else {
      datasets.push({
        type: 'bar',
        label: s.label,
        data: s.data,
        backgroundColor: col,
        borderRadius: 4,
        borderSkipped: false,
        barPercentage: barPct,
        categoryPercentage: 0.72,
        maxBarThickness: stacked ? 48 : (n <= 1 ? 42 : 30),
        order: i,
        _labelRole: 'value',
        _labelColor: col,
      });
    }
  });

  return new Chart(ctx, {
    type: 'bar',
    plugins: [_trendDataLabelsPlugin],
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
          align: 'center',
          labels: {
            color: text,
            boxWidth: 12,
            font: { size: 11 },
            filter: (item, chartData) => {
              if (kind === 'line') return chartData.datasets[item.datasetIndex].type !== 'line';
              return true;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: kind === 'bar' && stacked,
          ticks: { color: text, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
          grid: { display: false },
        },
        y: yScale,
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
  const idx = wrap.querySelectorAll('.tc-series-row').length + 1;
  row.innerHTML = `<div class="tc-series-row-top">
    <span class="tc-series-badge">${idx}</span>
    <button type="button" class="tc-series-remove" onclick="tcRemoveSeriesRow(this)" data-i18n-title="dash.trend_custom_remove_row" title="">&#10005;</button>
  </div>
  <div class="tc-series-grid">
    <div class="tc-series-field tc-series-field--metric">
      <select class="tc-metric f-select tc-input" onchange="tcRowSyncMetric(this.closest('.tc-series-row'))">${tcMetricOptionsHtml(pick)}</select>
    </div>
    <input type="text" class="tc-job-input tc-input f-input" list="tc-job-datalist" style="display:none" maxlength="200" data-i18n-placeholder="dash.trend_job_ph" placeholder="" />
    <input type="text" class="tc-svc-input tc-input f-input" list="tc-svc-datalist" style="display:none" maxlength="200" data-i18n-placeholder="dash.trend_svc_ph" placeholder="" />
    <div class="tc-series-field">
      <input type="text" class="tc-label tc-input f-input" data-i18n-placeholder="dash.trend_custom_legend_ph" placeholder="" />
    </div>
    <div class="tc-series-field tc-series-field--color">
      <select class="tc-color f-select tc-input">${tcColorOptionsHtml(colPick)}</select>
    </div>
  </div>`;
  wrap.appendChild(row);
  tcRowSyncMetric(row);
  tcRenumberSeriesRows();
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
  tcRenumberSeriesRows();
}

function tcRenumberSeriesRows() {
  const wrap = document.getElementById('tc-series-rows');
  if (!wrap) return;
  wrap.querySelectorAll('.tc-series-row').forEach((row, i) => {
    const badge = row.querySelector('.tc-series-badge');
    if (badge) badge.textContent = String(i + 1);
  });
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
  const isLine = k !== 'bar';
  if (lo) lo.hidden = !isLine;
  if (bo) bo.hidden = isLine;
  document.querySelectorAll('#tc-kind-seg .tc-seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tc-kind') === (isLine ? 'line' : 'bar'));
  });
}

function tcSetChartKind(kind) {
  const sel = document.getElementById('tc-kind');
  const val = kind === 'bar' ? 'bar' : 'line';
  if (sel) sel.value = val;
  tcSyncTrendModalKindUI();
}

function tcSetBarMode(mode) {
  const val = mode === 'stacked' ? 'stacked' : 'grouped';
  const inp = document.querySelector(`input[name="tc-bar-mode"][value="${val}"]`);
  if (inp) inp.checked = true;
  document.querySelectorAll('#tc-bar-mode-seg .tc-seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tc-bar') === val);
  });
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
  tcSetChartKind('line');
  const lf = document.getElementById('tc-line-fill');
  if (lf) lf.checked = true;
  const lp = document.getElementById('tc-line-points');
  if (lp) lp.value = 'none';
  tcSetBarMode('grouped');
  const cs = document.getElementById('tc-chart-smooth');
  if (cs) cs.value = 'none';
  const ym = document.getElementById('tc-y-max');
  if (ym) ym.value = '';
  const hg = document.getElementById('tc-hide-grid');
  if (hg) hg.checked = false;
  const lt = document.getElementById('tc-line-tension');
  if (lt) lt.value = '0.3';
  const adv = document.getElementById('tc-chart-adv');
  if (adv && typeof adv.open !== 'undefined') adv.open = false;
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
      <button type="button" class="chart-zoom-btn" data-dash-action="toggleChartFullscreen" data-dash-args='["chart-card-custom-${sid}",-1]' data-i18n-title="dash.zoom_chart" title="">&#x2922;</button>
      <button type="button" class="chart-del-btn" data-dash-action="removeCustomTrendChart" data-dash-args='["${sid}"]' data-i18n-title="dash.trend_custom_remove_chart" title="">&#10005;</button>
      <h3>${stitle}</h3>
      <canvas id="chart-custom-${sid}"></canvas>
    </div>`;
    })
    .join('');
  applyUITexts();
}

function buildCustomTrendCharts(data, labels) {
  const paletteCss = ['--chart-teal', '--st-failure', '--st-success', '--warn', '--purple'];
  const paletteFallback = [_trendTealColor(), '#f87171', '#4ade80', '#fbbf24', '#a78bfa'];
  const out = [];
  loadCustomTrendsConfig().forEach((cfg) => {
    const cid = 'chart-custom-' + cfg.id;
    const anyPct = cfg.series.some((s) => _trendMetricIsPct(s.metric));
    const yPrecision = anyPct ? 1 : 0;
    const linePts = _trendLinePointRadius(cfg.linePoints || 'none');
    const lt = parseFloat(cfg.lineTension, 10);
    const tension = cfg.kind === 'line' && !Number.isNaN(lt) && lt >= 0 && lt <= 1 ? lt : 0.1;
    const sm = cfg.chartSmooth || 'none';
    const hideGrid = !!cfg.hideGrid;
    const yMax = cfg.yMax;
    const pointRadius = linePts.r > 0 ? linePts.r : 5;
    const seriesList = cfg.series.map((s, i) => {
      const pi = typeof s.colorIdx === 'number' && s.colorIdx >= 0 && s.colorIdx <= 4 ? s.colorIdx : (i % paletteCss.length);
      let col = _cssVar(paletteCss[pi]);
      if (!col || col === '#94a3b8') col = paletteFallback[pi];
      let defLabel = t('dash.metric_' + s.metric);
      if (TREND_METRICS_JOB.includes(s.metric) && s.jobName) defLabel = `${defLabel}: ${s.jobName}`;
      if (s.metric === 'service_down' && s.serviceName) defLabel = `${defLabel}: ${s.serviceName}`;
      const label = (s.label && s.label.trim()) ? s.label.trim() : defLabel;
      let vals = data.map((d) => _trendSeriesVal(d, s));
      if (sm === 'ma3') vals = _movingAvg(vals, 3);
      else if (sm === 'ma7') vals = _movingAvg(vals, 7);
      return { label, data: vals, color: col, tension, pointRadius };
    });
    const ch = _mkCustomTrendChart(cid, labels, seriesList, {
      kind: cfg.kind,
      stacked: !!cfg.barStacked,
      yPrecision,
      showGrid: !hideGrid,
      yMax,
    });
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

  const src = _activeTrendsSource();
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
      builds_total: bsrc && typeof bsrc.total === 'number' ? bsrc.total : 0,
      builds_failed: bsrc && typeof bsrc.failed === 'number' ? bsrc.failed : 0,
      tests_total: tsrc && typeof tsrc.total === 'number' ? tsrc.total : 0,
      tests_failed: tsrc && typeof tsrc.failed === 'number' ? tsrc.failed : 0,
      top_test_failures: Array.isArray(topBySrc) ? topBySrc : [],
    };
  });
}

function renderTrendsFromCache() {
  renderTrendsChartsFromData(getTrendsViewData());
}

function onTrendsSmoothChange(el) {
  _trendsSmooth = el && el.value ? el.value : 'none';
  const ad = _filtersAdapter();
  if (ad && typeof ad.persistState === 'function') ad.persistState({ smooth: _trendsSmooth });
  else localStorage.setItem('cimon-trends-smooth', _trendsSmooth);
  if (_trendsRawCache && _trendsRawCache.length) renderTrendsFromCache();
}

function onTrendsTopNChange(el) {
  let n = parseInt(el && el.value, 10);
  if (!Number.isFinite(n)) n = 10;
  n = Math.min(100, Math.max(3, n));
  _trendsTopN = n;
  if (el && 'value' in el) el.value = String(n);
  const ad = _filtersAdapter();
  if (ad && typeof ad.persistState === 'function') ad.persistState({ topn: String(_trendsTopN) });
  else {
    try { localStorage.setItem('cimon-trends-topn', String(_trendsTopN)); } catch { /* ignore */ }
  }
  if (_trendsRawCache && _trendsRawCache.length) renderTrendsFromCache();
}

function onTrendsSourceChange(el) {
  _trendsSource = el && typeof el.value === 'string' ? el.value.trim().toLowerCase() : '';
  const st = _scopeStore();
  if (st && typeof st.setSource === 'function') st.setSource(_trendsSource);
  if (_trendsInstanceAll) {
    const instSrc = _sourceFromInstanceKey(_trendsInstanceAll);
    if (_trendsSource && instSrc && _trendsSource !== instSrc) {
      _trendsInstanceAll = '';
      const allEl = document.getElementById('trends-instance-all');
      if (allEl) allEl.value = '';
      try { localStorage.setItem('cimon-trends-inst-all', ''); } catch { /* ignore */ }
    }
  }
  try { localStorage.setItem('cimon-trends-source', _trendsSource); } catch { /* ignore */ }
  _syncTrendsScopeToGlobalIfEnabled();
  if (_trendsRawCache && _trendsRawCache.length) {
    renderTrendsFromCache();
    void loadTrendsHistorySummary(_trendsViewDays);
  }
}

function onTrendsTopTestSourceChange(el) {
  _trendsTopTestSource = el && typeof el.value === 'string' ? el.value.trim().toLowerCase() : '';
  try { localStorage.setItem('cimon-trends-top-test-source', _trendsTopTestSource); } catch { /* ignore */ }
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
  const ad = _filtersAdapter();
  if (ad && typeof ad.persistState === 'function') ad.persistState({ rfrom: df, rto: dt });
  else {
    localStorage.setItem('cimon-trends-rfrom', df);
    localStorage.setItem('cimon-trends-rto', dt);
  }
  document.querySelectorAll('.trend-period-btn').forEach((b) => b.classList.remove('active'));
  void loadTrends(_trendsViewDays, null);
}

function clearTrendsDateRange() {
  _trendsRangeActive = false;
  _trendsRangeFrom = '';
  _trendsRangeTo = '';
  const ad = _filtersAdapter();
  if (ad && typeof ad.persistState === 'function') ad.persistState({ rfrom: '', rto: '' });
  else {
    localStorage.removeItem('cimon-trends-rfrom');
    localStorage.removeItem('cimon-trends-rto');
  }
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

function resetTrendsFilters() {
  _trendsSource = '';
  _trendsTopTestSource = '';
  _trendsInstanceAll = '';
  _trendsInstSel = { builds: '', tests: '', top: '' };
  _trendsSmooth = 'none';
  _trendsTopN = 10;
  _trendsRangeActive = false;
  _trendsRangeFrom = '';
  _trendsRangeTo = '';
  const st = _scopeStore();
  if (st && typeof st.reset === 'function') st.reset();
  const ad = window.TrendsFiltersAdapter;
  if (ad && typeof ad.clearStorage === 'function') ad.clearStorage();
  if (ad && typeof ad.clearUI === 'function') ad.clearUI();
  if (ad && typeof ad.clearPeriodButtons === 'function') ad.clearPeriodButtons();
  else document.querySelectorAll('.trend-period-btn').forEach((b) => b.classList.remove('active'));
  _syncTrendsScopeToGlobalIfEnabled();
  void loadTrends(_trendsViewDays, null);
}

function toggleTrendsAdvancedFilters() {
  const bar = document.getElementById('trends-filters-bar');
  const btn = document.getElementById('btn-trends-more-filters');
  if (!bar) return;
  const open = bar.classList.toggle('trends-filters-advanced-open');
  if (btn) {
    btn.textContent = open ? t('dash.trends_less_filters') : t('dash.trends_more_filters');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
}

window.applyTrendsDateRange = applyTrendsDateRange;
window.clearTrendsDateRange = clearTrendsDateRange;
window.resetTrendsFilters = resetTrendsFilters;
window.toggleTrendsAdvancedFilters = toggleTrendsAdvancedFilters;
window.openTrendsChartModal = openTrendsChartModal;
window.closeTrendsChartModal = closeTrendsChartModal;
window.addCustomTrendChart = addCustomTrendChart;
window.tcAddSeriesRow = tcAddSeriesRow;
window.tcRemoveSeriesRow = tcRemoveSeriesRow;
window.tcRowSyncMetric = tcRowSyncMetric;
window.tcSyncTrendModalKindUI = tcSyncTrendModalKindUI;
window.tcSetChartKind = tcSetChartKind;
window.tcSetBarMode = tcSetBarMode;
window.removeCustomTrendChart = removeCustomTrendChart;
window.toggleChartFullscreen = toggleChartFullscreen;
window.setTrendsSize = setTrendsSize;
window.loadTrends = loadTrends;

function initTrendsChartModalBindings() {
  if (window._trendsChartModalInited) return;
  window._trendsChartModalInited = true;
  tcEnsureSeriesRows();
  tcSyncTrendModalKindUI();
}

function initTrendsFiltersFromStorage() {
  if (window._trendsFiltersInited) return;
  window._trendsFiltersInited = true;
  const st = _scopeStore();
  if (st && typeof st.load === 'function') st.load();
  const ad = _filtersAdapter();
  const adState = (ad && typeof ad.loadState === 'function') ? ad.loadState() : null;
  const tsm = adState ? adState.smooth : localStorage.getItem('cimon-trends-smooth');
  if (['none', 'ma3', 'ma7'].includes(tsm)) _trendsSmooth = tsm;
  const elSm = document.getElementById('trends-smooth');
  if (elSm) elSm.value = _trendsSmooth;
  const tsrc = (localStorage.getItem('cimon-trends-source') || '').trim().toLowerCase();
  if (tsrc) _trendsSource = tsrc;
  const elSrc = document.getElementById('trends-source');
  if (elSrc) elSrc.value = _trendsSource;
  const tts = (localStorage.getItem('cimon-trends-top-test-source') || '').trim().toLowerCase();
  if (tts) _trendsTopTestSource = tts;
  const elTts = document.getElementById('trends-top-test-source');
  if (elTts) elTts.value = _trendsTopTestSource;
  const ttn = parseInt(adState ? adState.topn : localStorage.getItem('cimon-trends-topn'), 10);
  if (Number.isFinite(ttn) && ttn >= 3 && ttn <= 100) _trendsTopN = ttn;
  const elTn = document.getElementById('trends-topn');
  if (elTn && 'value' in elTn) elTn.value = String(_trendsTopN);
  const allInstSaved = (localStorage.getItem('cimon-trends-inst-all') || '').trim();
  if (allInstSaved) _trendsInstanceAll = allInstSaved;
  const elSvKind = document.getElementById('trends-inst-svcs');
  const tsk = (localStorage.getItem('cimon-trends-inst-svcs') || '').trim();
  if (elSvKind && ['', 'docker', 'http', 'other'].includes(tsk)) elSvKind.value = tsk;
  const tp = parseInt(localStorage.getItem('cimon-trends-period'), 10);
  if ([3, 7, 14, 21, 30].includes(tp)) _trendsViewDays = tp;
  const rf = adState ? adState.rfrom : localStorage.getItem('cimon-trends-rfrom');
  const rt = adState ? adState.rto : localStorage.getItem('cimon-trends-rto');
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
  const cb = document.getElementById('trends-scope-global');
  if (cb) {
    cb.checked = !!(adState && adState.scopeGlobal);
    cb.addEventListener('change', () => {
      const ena = !!cb.checked;
      const adp = _filtersAdapter();
      if (adp && typeof adp.persistState === 'function') adp.persistState({ scopeGlobal: ena });
      if (ena) _syncTrendsScopeToGlobalIfEnabled();
    }, { passive: true });
  }
  initTrendsChartModalBindings();
}

function renderTrendsChartsFromData(data) {
  renderCustomTrendChartCards();
  if (!data.length) {
    if (_trendsCharts.length) return;
    _showTrendsEmptyState();
    return;
  }
  _hideTrendsEmptyPlaceholders();
  _destroyCharts();
  const labels = data.map((d) => _formatTrendDateLabel(d.date));
  const sm = _trendsSmooth;
  const sl = (arr) => _smoothSeries(arr, sm);
  const cTeal = _trendTealColor();
  const cFail = _cssVar('--st-failure');

  const getInstVal = (id) => (document.getElementById(id)?.value || '').trim();
  const globalInst = getInstVal('trends-instance-all');
  _trendsInstanceAll = globalInst;
  const instBuilds = globalInst || getInstVal('trends-inst-builds');
  const instTests = globalInst || getInstVal('trends-inst-tests');
  const instTop = globalInst || getInstVal('trends-inst-top');

  const buildTotals = data.map((d) => {
    if (!instBuilds) return d.builds_total;
    const m = d.builds_by_instance && d.builds_by_instance[instBuilds];
    return m && typeof m.total === 'number' ? m.total : 0;
  });
  const buildFails = data.map((d) => {
    if (!instBuilds) return d.builds_failed;
    const m = d.builds_by_instance && d.builds_by_instance[instBuilds];
    return m && typeof m.failed === 'number' ? m.failed : 0;
  });
  const cBuilds = _mkComboBarLine('chart-builds', labels, sl(buildTotals), sl(buildFails), {
    totalLabel: t('dash.chart_total_builds'),
    failLabel: t('dash.chart_failed_builds'),
    yTitle: t('dash.chart_axis_builds'),
    totalColor: cTeal,
    failColor: cFail,
  });

  const instToTestSrc = (v) => (v.startsWith('jenkins|') ? 'jenkins' : v.startsWith('gitlab|') ? 'gitlab' : '');
  const wantTestSrc = instToTestSrc(instTests);
  const testTotalsLine = data.map((d) => {
    if (!wantTestSrc) return d.tests_total;
    const m = d.tests_by_source && d.tests_by_source[wantTestSrc];
    return m && typeof m.total === 'number' ? m.total : 0;
  });
  const testFailsLine = data.map((d) => {
    if (!wantTestSrc) return d.tests_failed;
    const m = d.tests_by_source && d.tests_by_source[wantTestSrc];
    return m && typeof m.failed === 'number' ? m.failed : 0;
  });
  const cTests = _mkComboBarLine('chart-tests', labels, sl(testTotalsLine), sl(testFailsLine), {
    totalLabel: t('dash.chart_total_tests'),
    failLabel: t('dash.chart_failed_tests'),
    yTitle: t('dash.chart_axis_tests'),
    totalColor: cTeal,
    failColor: cFail,
  });

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
  const topSrc = (_trendsTopTestSource || '').trim().toLowerCase() || wantTopSrc;
  const testTotals = {};
  data.forEach((d) => {
    const arr = topSrc && d.top_test_failures_by_source && Array.isArray(d.top_test_failures_by_source[topSrc])
      ? d.top_test_failures_by_source[topSrc]
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

  if (shouldSkipTrendsReloadDuringCollect()) return;

  const prevCache = Array.isArray(_trendsRawCache) && _trendsRawCache.length ? _trendsRawCache : null;
  _setTrendsLoading(true);

  const errEl = document.getElementById('trends-error');
  let data;
  try {
    const nd = _trendsApiDaysFetch();
    const res = await fetchKeyed('trends', apiUrl(`api/trends?days=${nd}`)).catch(() => null);
    if (res === FETCH_ABORTED) return;
    if (!res || !res.ok) {
      if (errEl && !prevCache) {
        errEl.style.display = 'flex';
        errEl.innerHTML = `<span>${esc(t('trends_err'))} (HTTP ${res ? res.status : '—'})</span><button type="button" class="btn btn-ghost" onclick="loadTrends(${_trendsViewDays},null)">${t('common.retry')}</button>`;
      }
      return;
    }
    data = await res.json();
  } catch (e) {
    if (errEl && !prevCache) {
      errEl.style.display = 'flex';
      errEl.innerHTML = `<span>${esc(t('trends_err'))}</span><button type="button" class="btn btn-ghost" onclick="loadTrends(${_trendsViewDays},null)">${t('common.retry')}</button>`;
    }
    return;
  } finally {
    _setTrendsLoading(false);
  }

  const next = Array.isArray(data) ? data : [];
  if (!next.length && prevCache && _trendsCollectGraceActive()) return;

  _trendsRawCache = next;
  if (errEl) {
    errEl.style.display = 'none';
    errEl.innerHTML = '';
  }
  try {
    if (typeof ensureChartJs === 'function') await ensureChartJs();
  } catch {
    if (errEl) {
      errEl.style.display = 'flex';
      errEl.innerHTML = `<span>${esc(t('trends_err'))}</span>`;
    }
    return;
  }
  renderTrendsChartsFromData(getTrendsViewData());
  loadTrendsHistorySummary(_trendsApiDaysFetch());
}

window.shouldSkipTrendsReloadDuringCollect = shouldSkipTrendsReloadDuringCollect;

