// ─────────────────────────────────────────────────────────────────────────────
// Source filter dropdown population
// ─────────────────────────────────────────────────────────────────────────────
async function populateSources() {
  const res = await fetch(apiUrl('api/sources')).catch(()=>null);
  if (!res || !res.ok) return;
  const sources = await res.json();
  const sel = document.getElementById('f-source');
  if (!sel) return;
  // Rebuild options every time (sources can change after Collect / settings updates).
  const cur = sel.value;
  while (sel.options.length > 1) sel.remove(1); // keep "All sources"
  sources.forEach(src => {
    const opt = document.createElement('option');
    opt.value = src; opt.textContent = src;
    sel.appendChild(opt);
  });
  // Keep current selection if still present.
  if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
  updateFilterSummary();
}

async function populateInstances() {
  const res = await fetch(apiUrl('api/instances')).catch(()=>null);
  if (!res || !res.ok) return;
  const items = await res.json();
  const sel = document.getElementById('f-instance');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">All instances</option>`;
  (items || []).forEach((it) => {
    const name = (it && it.name) ? String(it.name) : '';
    if (!name) return;
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });
  if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
}

/** Instance options must exist before restoring LS/URL filters (avoids stale instance hiding builds). */
async function populateSourcesAndInstances() {
  await populateInstances();
  await populateSources();
  _maybeRestoreFiltersFromLS();
  _pruneInvalidBuildInstanceFilter();
  updateFilterSummary();
}

function _pruneInvalidBuildInstanceFilter() {
  const sel = document.getElementById('f-instance');
  if (!sel || !sel.value) return;
  if ([...sel.options].some((o) => o.value === sel.value)) return;
  sel.value = '';
  try { localStorage.removeItem('cimon-f-instance'); } catch { /* ignore */ }
  _writeURLFilters();
}
