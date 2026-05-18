// ─────────────────────────────────────────────────────────────────────────────
// Theme (dark / light)
// ─────────────────────────────────────────────────────────────────────────────
function _applyTheme(theme) {
  document.documentElement.classList.toggle('light', theme === 'light');
  const btn = document.getElementById('btn-theme');
  if (btn) btn.setAttribute('title', theme === 'light' ? t('dash.theme_light_hint') : t('dash.theme_dark_hint'));
  if (btn) btn.textContent = theme === 'light' ? '🌙' : '☀';
}
function toggleTheme() {
  const next = document.documentElement.classList.contains('light') ? 'dark' : 'light';
  localStorage.setItem('cimon-theme', next);
  _applyTheme(next);
  // Redraw chart.js charts with new colors
  _trendsCharts.forEach(c => c && c.update());
}

// ─────────────────────────────────────────────────────────────────────────────
// Compact mode
// ─────────────────────────────────────────────────────────────────────────────
function toggleCompact() {
  const on = document.body.classList.toggle('compact');
  localStorage.setItem('cimon-compact', on ? '1' : '');
  const btn = document.getElementById('btn-compact');
  if (btn) {
    btn.style.opacity = on ? '1' : '';
    btn.style.background = on ? 'var(--info)' : '';
    btn.style.color = on ? '#fff' : '';
    btn.setAttribute('title', on ? t('dash.compact') : t('dash.compact_off'));
    btn.setAttribute('aria-label', on ? t('dash.compact') : t('dash.compact_off'));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV Export (current builds, all pages)
// ─────────────────────────────────────────────────────────────────────────────
async function exportCSV() {
  const source = document.getElementById('f-source')?.value || '';
  const inst   = document.getElementById('f-instance')?.value || '';
  const status = document.getElementById('f-bstatus')?.value || '';
  const job    = document.getElementById('f-job')?.value || '';
  let url = apiUrl(`api/builds?page=1&per_page=10000&source=${encodeURIComponent(source)}&instance=${encodeURIComponent(inst)}&status=${encodeURIComponent(status)}&job=${encodeURIComponent(job)}`);
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) { showToast(t('dash.export_failed'), 'err'); return; }
  const data = await res.json();
  const rows = data.items || [];
  if (!rows.length) { showToast(t('dash.export_none'), 'err'); return; }
  const cols = ['source','job_name','build_number','status','branch','started_at','duration_seconds','url'];
  const lines = [cols.join(',')];
  rows.forEach(r => lines.push(cols.map(c => {
    const v = r[c] ?? '';
    return `"${String(v).replace(/"/g,'""')}"`;
  }).join(',')));
  const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `builds_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  showToast(`${t('dash.export_ok')} ${rows.length} ${t('dash.rows')}`, 'ok');
}

