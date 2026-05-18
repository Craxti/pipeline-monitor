// Overview timeline (persisted events + snapshot activity).
// Load after dashboard.diff-stages.js, before the rest of dashboard.js.

// ─────────────────────────────────────────────────────────────────────────────
// Timeline / Event Feed
// ─────────────────────────────────────────────────────────────────────────────
function _tlAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = Date.now();
  const secs = Math.floor((now - d) / 1000);
  if (secs < 60) return secs + 's ago';
  if (secs < 3600) return Math.floor(secs/60) + 'm ago';
  if (secs < 86400) return Math.floor(secs/3600) + 'h ago';
  return Math.floor(secs/86400) + 'd ago';
}

function _persistedToTimelineEv(p) {
  const K = {
    build_fail:     { icon: '✗', cls: 'ti-fail' },
    build_recovered:{ icon: '✓', cls: 'ti-ok' },
    svc_down:       { icon: '✗', cls: 'ti-fail' },
    svc_recovered:  { icon: '✓', cls: 'ti-ok' },
  };
  const m = K[p.kind] || { icon: '●', cls: 'ti-info' };
  return {
    ts: p.ts,
    icon: m.icon,
    cls: m.cls,
    title: p.title || p.kind || 'Event',
    detail: p.detail || '',
    url: p.url || null,
    _prio: 1,
  };
}

function renderTimeline(builds, services, persistedList) {
  const list  = document.getElementById('wrap-tl');
  const count = document.getElementById('tl-count');
  if (!list) return;

  const STATUS_ICON = { success:'✓', failure:'✗', running:'▶', unstable:'⚠', aborted:'■', unknown:'?' };
  const STATUS_CLS  = { success:'ti-ok', failure:'ti-fail', running:'ti-run', unstable:'ti-warn', aborted:'ti-info', unknown:'ti-info' };
  const SVC_ICON    = { up:'✓', down:'✗', degraded:'⚠' };
  const SVC_CLS     = { up:'ti-ok', down:'ti-fail', degraded:'ti-warn' };

  const events = [];

  (persistedList || []).forEach(p => events.push(_persistedToTimelineEv(p)));

  builds.forEach(b => {
    if (!b.started_at) return;
    const st = normalizeBuildStatus(b.status);
    events.push({
      ts: b.started_at,
      icon: STATUS_ICON[st] || '?',
      cls:  STATUS_CLS[st]  || 'ti-info',
      title: `${b.source} / ${b.job_name} #${b.build_number || '?'}`,
      detail: `${st}${b.branch ? ' · ' + b.branch : ''}${b.duration_seconds ? ' · ' + dur(b.duration_seconds) : ''}`,
      url: b.url,
      _prio: 0,
    });
  });

  services.filter(s => normalizeServiceStatus(s && s.status) !== 'up').forEach(sv => {
    if (!sv.checked_at) return;
    const ss = normalizeServiceStatus(sv.status);
    events.push({
      ts: sv.checked_at,
      icon: SVC_ICON[ss] || '?',
      cls:  SVC_CLS[ss]  || 'ti-info',
      title: `${sv.kind}: ${sv.name}`,
      detail: sv.detail || ss,
      url: null,
      _prio: 0,
    });
  });

  events.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')) || ((b._prio || 0) - (a._prio || 0)));

  const seen = new Set();
  const deduped = [];
  for (const ev of events) {
    const k = `${(ev.title || '').slice(0, 120)}|${String(ev.ts || '').slice(0, 16)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(ev);
    if (deduped.length >= 220) break;
  }

  if (!deduped.length) {
    list.innerHTML = '<div style="padding:1rem;color:var(--muted);font-size:.85rem">No events yet — run Collect first.</div>';
    if (count) count.textContent = '0';
    return;
  }

  list.innerHTML = deduped.slice(0, 200).map(ev => `
    <div class="tl-item">
      <div class="tl-icon ${_escHtml(ev.cls)}">${_escHtml(ev.icon)}</div>
      <div class="tl-body">
        <div class="tl-title">${ev.url ? `<a href="${_escHtml(ev.url)}" target="_blank" style="color:inherit;text-decoration:none;hover:underline">${_escHtml(ev.title)}</a>` : _escHtml(ev.title)}</div>
        <div class="tl-detail">${_escHtml(ev.detail)}</div>
      </div>
      <div class="tl-time">${_tlAgo(ev.ts)}</div>
    </div>`).join('');

  if (count) count.textContent = String(deduped.length);
}
