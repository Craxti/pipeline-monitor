// Host system monitoring tab.

let _systemPollTimer = null;

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

async function loadSystemStats() {
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
  if (updEl) updEl.textContent = d.updated_at ? fmt(d.updated_at) : '—';
  if (tbody) {
    const items = Array.isArray(d.top_processes) ? d.top_processes : [];
    if (!items.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="4">${esc(t('dash.table_no_data'))}</td></tr>`;
    } else {
      tbody.innerHTML = items.map((p) => `<tr>
        <td>${esc(p.name || '')}</td>
        <td>${esc(String(p.pid || ''))}</td>
        <td title="${esc(`raw: ${_fmtPct(p.cpu_percent_raw)}`)}">${esc(_fmtPct(p.cpu_percent))}</td>
        <td>${esc(`${_fmtPct(p.memory_percent)} (${_fmtBytes((d.memory && d.memory.total) ? (Number(d.memory.total) * Number(p.memory_percent || 0) / 100) : 0)})`)}</td>
      </tr>`).join('');
    }
  }
}

function restartSystemMonitorPolling() {
  try { if (_systemPollTimer) clearInterval(_systemPollTimer); } catch { /* ignore */ }
  _systemPollTimer = setInterval(() => {
    if (_dashTab === 'system') loadSystemStats();
  }, 3000);
}
