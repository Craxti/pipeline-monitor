// Host system monitoring tab.

let _systemPollTimer = null;
let _systemRows = [];
let _systemSort = { key: 'cpu', dir: 'desc' };
let _systemHdrInit = false;

function _fmtPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${Math.round(n)}%`;
}

function _fmtBytes(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let x = n;
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i += 1; }
  return `${x.toFixed(i < 2 ? 0 : 1)} ${u[i]}`;
}

function _systemCmp(a, b, key, dir) {
  const mul = dir === 'asc' ? 1 : -1;
  if (key === 'name') {
    return String(a.name || '').localeCompare(String(b.name || '')) * mul;
  }
  if (key === 'pid') {
    return (Number(a.pid || 0) - Number(b.pid || 0)) * mul;
  }
  if (key === 'mem') {
    return (Number(a.memory_percent || 0) - Number(b.memory_percent || 0)) * mul;
  }
  // cpu default
  return (Number(a.cpu_percent || 0) - Number(b.cpu_percent || 0)) * mul;
}

function _renderSystemRows(memoryTotal) {
  const tbody = document.getElementById('tbody-system-procs');
  if (!tbody) return;
  const items = Array.isArray(_systemRows) ? [..._systemRows] : [];
  if (!items.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="4">${esc(t('dash.table_no_data'))}</td></tr>`;
    return;
  }
  items.sort((a, b) => _systemCmp(a, b, _systemSort.key, _systemSort.dir));
  tbody.innerHTML = items.map((p) => `<tr>
    <td>${esc(p.name || '')}</td>
    <td>${esc(String(p.pid || ''))}</td>
    <td title="${esc(`raw: ${_fmtPct(p.cpu_percent_raw)}`)}">${esc(_fmtPct(p.cpu_percent))}</td>
    <td>${esc(`${_fmtPct(p.memory_percent)} (${_fmtBytes(memoryTotal ? (Number(memoryTotal) * Number(p.memory_percent || 0) / 100) : 0)})`)}</td>
  </tr>`).join('');
}

function _updateSystemSortHdr() {
  const table = document.querySelector('#panel-system table');
  if (!table) return;
  const ths = table.querySelectorAll('thead tr.th-cols th');
  if (ths.length < 4) return;
  const map = ['name', 'pid', 'cpu', 'mem'];
  map.forEach((k, i) => {
    const th = ths[i];
    if (!th) return;
    const base = String(th.getAttribute('data-sort-label') || th.textContent || '').trim();
    if (!th.getAttribute('data-sort-label')) th.setAttribute('data-sort-label', base);
    const arrow = _systemSort.key === k ? (_systemSort.dir === 'asc' ? ' ↑' : ' ↓') : '';
    th.textContent = base + arrow;
  });
}

function _initSystemSorting() {
  if (_systemHdrInit) return;
  const table = document.querySelector('#panel-system table');
  if (!table) return;
  const ths = table.querySelectorAll('thead tr.th-cols th');
  if (ths.length < 4) return;
  const map = ['name', 'pid', 'cpu', 'mem'];
  map.forEach((k, i) => {
    const th = ths[i];
    if (!th) return;
    th.style.cursor = 'pointer';
    th.title = 'Sort';
    th.addEventListener('click', () => {
      if (_systemSort.key === k) _systemSort.dir = _systemSort.dir === 'asc' ? 'desc' : 'asc';
      else { _systemSort.key = k; _systemSort.dir = (k === 'name' || k === 'pid') ? 'asc' : 'desc'; }
      _updateSystemSortHdr();
      const total = Number(document.getElementById('sys-mem')?.getAttribute('data-total-bytes') || 0);
      _renderSystemRows(total);
    });
  });
  _systemHdrInit = true;
  _updateSystemSortHdr();
}

async function loadSystemStats() {
  _initSystemSorting();
  const res = await fetch(apiUrl('api/system/metrics')).catch(() => null);
  if (!res || !res.ok) return;
  const d = await res.json().catch(() => null);
  if (!d) return;
  const cpuEl = document.getElementById('sys-cpu');
  const memEl = document.getElementById('sys-mem');
  const diskEl = document.getElementById('sys-disk');
  const procEl = document.getElementById('sys-proc');
  const updEl = document.getElementById('system-updated-at');
  const tbody = document.getElementById('tbody-system-procs');
  if (cpuEl) cpuEl.textContent = _fmtPct(d.cpu_percent);
  if (memEl) memEl.textContent = _fmtPct(d.memory && d.memory.percent);
  if (diskEl) diskEl.textContent = _fmtPct(d.disk && d.disk.percent);
  if (procEl) procEl.textContent = String(d.process_count || 0);
  if (updEl) {
    const ts = d.updated_at ? fmt(d.updated_at) : '—';
    const note = String(d.scope_note || '').trim();
    updEl.textContent = note ? `${ts} · ${note}` : ts;
    updEl.title = String(d.scope || '');
  }
  if (memEl) memEl.setAttribute('data-total-bytes', String((d.memory && d.memory.total) ? Number(d.memory.total) : 0));
  _systemRows = Array.isArray(d.top_processes) ? d.top_processes : [];
  _renderSystemRows((d.memory && d.memory.total) ? Number(d.memory.total) : 0);
}

function restartSystemMonitorPolling() {
  try { if (_systemPollTimer) clearInterval(_systemPollTimer); } catch { /* ignore */ }
  _systemPollTimer = setInterval(() => {
    if (_dashTab === 'system') loadSystemStats();
  }, 3000);
}
