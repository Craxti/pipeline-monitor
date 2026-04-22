// ─────────────────────────────────────────────────────────────────────────────
// Actions / UI helpers (split out of dashboard.js)
// ─────────────────────────────────────────────────────────────────────────────

// ── Action helpers ─────────────────────────────────────────────────────────
function showToast(msg, type = 'ok') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), 5000);
  srAnnounce(msg, type === 'err' ? 'assertive' : 'polite');
}

/** Beautiful confirm dialog. kind: jenkins | gitlab | docker */
function openActionConfirm(opts) {
  return new Promise((resolve) => {
    const ov = document.getElementById('action-modal');
    const icon = document.getElementById('modal-icon');
    const title = document.getElementById('modal-title');
    const sub = document.getElementById('modal-sub');
    const wrap = document.getElementById('modal-target-wrap');
    const tLabel = document.getElementById('modal-target-label');
    const tText = document.getElementById('modal-target-text');
    const meta = document.getElementById('modal-meta');
    const okBtn = document.getElementById('modal-ok');
    const cancelBtn = document.getElementById('modal-cancel');

    const kind = opts.kind || 'jenkins';
    icon.className = 'modal-icon ' + kind;
    icon.innerHTML = kind === 'jenkins' ? '&#128296;' : kind === 'gitlab' ? '&#129347;' : '&#128051;';

    title.textContent = opts.title || t('dash.action_confirm');
    sub.textContent = opts.subtitle || '';
    tLabel.textContent = opts.targetLabel || t('dash.modal_target');
    tText.textContent = opts.targetText || '';
    wrap.style.display = opts.targetText ? 'block' : 'none';
    meta.innerHTML = opts.metaHtml || '';

    okBtn.textContent = opts.okText || t('dash.action_confirm');
    if (cancelBtn) cancelBtn.textContent = t('dash.action_cancel');
    okBtn.className = opts.dangerOk
      ? 'modal-btn modal-btn-ok danger'
      : 'modal-btn modal-btn-ok ' + kind;

    // Branch input (for GitLab pipeline)
    const branchWrap  = document.getElementById('modal-branch-wrap');
    const branchInput = document.getElementById('modal-branch-input');
    if (opts.branchValue !== undefined) {
      branchWrap.style.display = '';
      branchInput.value = opts.branchValue || 'main';
    } else {
      branchWrap.style.display = 'none';
    }

    const cleanup = () => {
      ov.classList.remove('open');
      ov.setAttribute('aria-hidden', 'true');
      document.removeEventListener('keydown', onKey);
    };
    const finish = (yes) => {
      cleanup();
      resolve(yes ? { confirmed: true, branch: branchInput.value.trim() || 'main' } : null);
    };

    const onKey = (e) => { if (e.key === 'Escape') finish(null); };

    document.getElementById('modal-cancel').onclick = () => finish(null);
    okBtn.onclick = () => finish(true);
    ov.onclick = (e) => { if (e.target === ov) finish(null); };

    const onEnter = (e) => { if (e.key === 'Enter' && document.activeElement === branchInput) finish(true); };
    branchInput.addEventListener('keydown', onEnter);

    document.addEventListener('keydown', onKey);
    ov.setAttribute('aria-hidden', 'false');
    ov.classList.add('open');
    requestAnimationFrame(() => okBtn.focus());
  });
}

async function triggerJenkinsBuild(a, b, c) {
  let btn = a;
  let jobName = b;
  let instanceUrl = c || '';
  // Called via delegated data-dash-action: (jobName, buttonEl)
  if (typeof a === 'string') {
    jobName = a;
    instanceUrl = typeof b === 'string' ? b : '';
    btn = c;
  }
  if (!btn || typeof btn.classList === 'undefined') return;
  const r = await openActionConfirm({
    kind: 'jenkins',
    title: t('dash.act_jenkins_title'),
    subtitle: t('dash.act_jenkins_sub'),
    targetLabel: t('dash.act_target_job'),
    targetText: jobName,
    okText: t('dash.act_jenkins_ok'),
  });
  if (!r) return;
  btn.classList.add('running');
  btn.innerHTML = '&#9203; ' + t('dash.act_running');
  try {
    const res = await fetch(apiUrl('api/action/jenkins/build'), {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        job_name: jobName,
        instance_url: String(instanceUrl || ''),
      }),
    });
    if (res.ok) {
      showToast(tf('dash.act_jenkins_queued', { name: jobName }), 'ok');
      _monitorBuildsAfterTrigger();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(tf('dash.act_fail', { detail: err.detail || res.statusText }), 'err');
    }
  } catch(e) { showToast(tf('dash.act_err', { msg: e.message }), 'err'); }
  btn.classList.remove('running');
  btn.innerHTML = '&#9654; ' + t('dash.act_run');
}

async function triggerGitlabPipeline(...args) {
  const btn = args[args.length - 1];
  if (!btn || typeof btn.classList === 'undefined') return;
  const rest = args.slice(0, -1);
  let projectId = '';
  let ref = 'main';
  let instanceUrl = '';
  if (rest.length >= 3) {
    projectId = String(rest[0] ?? '');
    ref = String(rest[1] ?? 'main');
    instanceUrl = String(rest[2] ?? '');
  } else if (rest.length === 2) {
    projectId = String(rest[0] ?? '');
    ref = String(rest[1] ?? 'main');
  } else {
    return;
  }
  const r = await openActionConfirm({
    kind: 'gitlab',
    title: t('dash.act_gitlab_title'),
    subtitle: t('dash.act_gitlab_sub'),
    targetLabel: t('dash.act_target_project'),
    targetText: projectId,
    branchValue: ref || 'main',
    okText: t('dash.act_gitlab_ok'),
  });
  if (!r) return;
  const branch = r.branch || ref || 'main';
  btn.classList.add('running');
  btn.innerHTML = '&#9203; ' + t('dash.act_running');
  try {
    const res = await fetch(apiUrl('api/action/gitlab/pipeline'), {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        project_id: projectId,
        ref: branch,
        instance_url: String(instanceUrl || ''),
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const msg = data.web_url
        ? tf('dash.act_gitlab_toast_linked', { url: data.web_url })
        : t('dash.act_gitlab_toast_queued');
      showToast(msg, 'ok');
      _monitorBuildsAfterTrigger();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(tf('dash.act_fail', { detail: err.detail || res.statusText }), 'err');
    }
  } catch(e) { showToast(tf('dash.act_err', { msg: e.message }), 'err'); }
  btn.classList.remove('running');
  btn.innerHTML = '&#9654; ' + t('dash.act_run');
}

function _dockerConfirmOpts(action, containerName) {
  const base = {
    kind: 'docker',
    targetLabel: t('dash.act_target_container'),
    targetText: containerName,
  };
  if (action === 'start') {
    return {
      ...base,
      title: t('dash.act_docker_start_title'),
      subtitle: t('dash.act_docker_start_sub'),
      okText: t('dash.act_docker_start_ok'),
      dangerOk: false,
    };
  }
  if (action === 'stop') {
    return {
      ...base,
      title: t('dash.act_docker_stop_title'),
      subtitle: t('dash.act_docker_stop_sub'),
      okText: t('dash.act_docker_stop_ok'),
      dangerOk: true,
    };
  }
  return {
    ...base,
    title: t('dash.act_docker_restart_title'),
    subtitle: t('dash.act_docker_restart_sub'),
    okText: t('dash.act_docker_restart_ok'),
    dangerOk: false,
  };
}

function _mapDockerContainerStateToSvcStatus(state) {
  return String(state || '').toLowerCase() === 'running' ? 'up' : 'down';
}

function _normSvcNameKey(raw) {
  try {
    return String(decodeURIComponent(raw || '')).trim().replace(/^\/+/, '').toLowerCase();
  } catch {
    return String(raw || '').trim().replace(/^\/+/, '').toLowerCase();
  }
}

function _normSvcHostKey(raw) {
  let h = '';
  try { h = decodeURIComponent(raw || ''); } catch { h = String(raw || ''); }
  const t = String(h).trim().toLowerCase();
  return t || 'local';
}

function _touchServiceRowStatus(containerName, dockerHost, containerState, detailText) {
  const tbody = document.getElementById('tbody-svcs');
  if (!tbody) return;
  const wantName = String(containerName || '').trim().replace(/^\/+/, '').toLowerCase();
  const wantHost = String(dockerHost || '').trim().toLowerCase() || 'local';
  const rows = Array.from(tbody.querySelectorAll('tr[data-svc-name]'));
  const row = rows.find((r) => {
    const n = _normSvcNameKey(r.getAttribute('data-svc-name') || '');
    const h = _normSvcHostKey(r.getAttribute('data-svc-host') || '');
    return n === wantName && h === wantHost;
  }) || rows.find((r) => _normSvcNameKey(r.getAttribute('data-svc-name') || '') === wantName);
  if (!row || !row.children) return;
  const statusCell = row.children[2];
  const detailCell = row.children[3];
  if (statusCell) {
    statusCell.innerHTML = badge(_mapDockerContainerStateToSvcStatus(containerState));
  }
  if (detailCell && detailText) {
    detailCell.textContent = detailText;
  }
}

function _monitorBuildsAfterTrigger() {
  try { resetBuilds(true, true); } catch { /* ignore */ }
  let n = 0;
  const maxPolls = 8;
  const tid = setInterval(() => {
    n += 1;
    try { resetBuilds(true, true); } catch { /* ignore */ }
    if (n >= maxPolls) clearInterval(tid);
  }, 2500);
}

async function dockerContainerAction(a, b, c, d = '') {
  let btn = a;
  let containerName = b;
  let action = c;
  let dockerHost = d;
  // Called via delegated data-dash-action: (containerName, action, dockerHost, buttonEl)
  if (typeof a === 'string') {
    containerName = a;
    action = b;
    dockerHost = c || '';
    btn = d;
  }
  if (!btn || typeof btn.closest !== 'function') return;
  const cfg = _dockerConfirmOpts(action, containerName);
  const r = await openActionConfirm(cfg);
  if (!r) return;

  const group = btn.closest('.act-group');
  if (group) group.classList.add('busy');

  const labels = { start: t('dash.act_docker_busy_start'), stop: t('dash.act_docker_busy_stop'), restart: t('dash.act_docker_busy_restart') };
  const orig = btn.innerHTML;
  btn.classList.add('running');
  btn.innerHTML = '&#9203; ' + (labels[action] || '…');

  try {
    const res = await fetch(apiUrl('api/action/docker/container'), {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ container_name: containerName, action, docker_host: String(dockerHost || '') }),
    });
    if (res.ok) {
      const data = await res.json();
      const st = data.status || '';
      const rowName = String(data.name || data.container_name || containerName || '');
      const rowHost = String(data.docker_host != null ? data.docker_host : dockerHost || '');
      const hostShown = String(rowHost || '').trim() || 'local';
      const detailStr = `host=${hostShown}; state=${String(st || '').toLowerCase()}`;
      const verbKey = { start: 'dash.act_docker_verb_start', stop: 'dash.act_docker_verb_stop', restart: 'dash.act_docker_verb_restart' }[action];
      const verb = verbKey ? t(verbKey) : action;
      showToast(tf('dash.act_docker_toast', { verb, name: rowName || containerName, extra: st ? ` (${st})` : '' }), 'ok');
      _touchServiceRowStatus(rowName || containerName, rowHost, st, detailStr);
      // Force a fresh services fetch: cancel potentially stale in-flight request.
      resetServices(true, true);
      // Docker state may lag for a brief moment; do one follow-up refresh.
      setTimeout(() => {
        try { resetServices(true, true); } catch { /* ignore */ }
      }, 1200);
    } else {
      const err = await res.json().catch(() => ({}));
      const detail = err.detail || res.statusText;
      if (res.status === 429) showToast(tf('dash.act_rate_limit', { detail }), 'err');
      else showToast(tf('dash.act_fail', { detail }), 'err');
    }
  } catch (e) {
    showToast(tf('dash.act_err', { msg: e.message }), 'err');
  }

  btn.classList.remove('running');
  btn.innerHTML = orig;
  if (group) group.classList.remove('busy');
}

// ─────────────────────────────────────────────────────────────────────────────
// Global search (client-side — filters loaded DOM rows across all tables)
// ─────────────────────────────────────────────────────────────────────────────
let _gsQuery = '';

/** Lowercased text used for matching (textContent + key row attributes). */
function _globalSearchRowHaystack(tr) {
  let s = (tr.textContent || '').toLowerCase();
  const dj = tr.getAttribute('data-job');
  if (dj) {
    try { s += ' ' + decodeURIComponent(dj).toLowerCase(); } catch { s += ' ' + dj.toLowerCase(); }
  }
  const dfj = tr.getAttribute('data-fav-job');
  if (dfj) s += ' ' + String(dfj).toLowerCase();
  return s;
}

function globalSearch(q) {
  _gsQuery = (q || '').toLowerCase().trim();
  const clearBtn = document.getElementById('global-search-clear');
  if (clearBtn) clearBtn.classList.toggle('visible', !!_gsQuery);

  const tbodies = ['tbody-builds','tbody-failures','tbody-tests','tbody-svcs','tbody-fav'];
  tbodies.forEach(id => {
    const tbody = document.getElementById(id);
    if (!tbody) return;
    Array.from(tbody.querySelectorAll('tr')).forEach(tr => {
      if (tr.classList.contains('empty-row') || tr.classList.contains('load-more-row')) return;
      // Build group headers: match is decided after data rows (headers rarely contain job names).
      if (id === 'tbody-builds' && tr.classList.contains('src-group-row') && _gsQuery) return;
      const hay = _globalSearchRowHaystack(tr);
      const matches = !_gsQuery || hay.includes(_gsQuery);
      tr.classList.toggle('row-hidden-search', !matches);
    });
  });

  const tbodyBuilds = document.getElementById('tbody-builds');
  if (tbodyBuilds) {
    tbodyBuilds.querySelectorAll('tr.gs-reveal-match').forEach((tr) => tr.classList.remove('gs-reveal-match'));
    if (_gsQuery) {
      tbodyBuilds.querySelectorAll('tr[data-bgroup]:not(.src-group-row)').forEach((tr) => {
        if (tr.classList.contains('empty-row') || tr.classList.contains('load-more-row')) return;
        if (!tr.classList.contains('row-hidden-search')) tr.classList.add('gs-reveal-match');
      });
      const groupHasVisible = {};
      tbodyBuilds.querySelectorAll('tr[data-bgroup]:not(.src-group-row)').forEach((tr) => {
        if (tr.classList.contains('empty-row') || tr.classList.contains('load-more-row')) return;
        const g = tr.getAttribute('data-bgroup');
        if (!g) return;
        if (!tr.classList.contains('row-hidden-search')) groupHasVisible[g] = true;
      });
      tbodyBuilds.querySelectorAll('tr.src-group-row[data-bgroup]').forEach((tr) => {
        const g = tr.getAttribute('data-bgroup');
        tr.classList.toggle('row-hidden-search', !groupHasVisible[g]);
      });
    } else {
      tbodyBuilds.querySelectorAll('tr.src-group-row').forEach((tr) => tr.classList.remove('row-hidden-search'));
      try {
        _collapsedBuildGroups.forEach((enc) => applyBuildGroupVisibility(enc));
      } catch { /* ignore */ }
    }
  }
}

function clearGlobalSearch() {
  const inp = document.getElementById('global-search');
  if (inp) inp.value = '';
  globalSearch('');
}

// Re-apply search after rows are loaded
function _applyGlobalSearch() {
  const inp = document.getElementById('global-search');
  globalSearch(inp ? inp.value : '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────────
let _notifMaxId = 0;
let _notifSeen = 0;
let _notifClientExtraUnread = 0;
let _staleDataNotifEpisodeShown = false;

function _notifCombinedUnread() {
  return Math.max(0, _notifMaxId - _notifSeen) + _notifClientExtraUnread;
}

function _syncNotifBadgeFromState() {
  const panel = document.getElementById('notif-panel');
  const open = panel && panel.classList.contains('open');
  if (open) return;
  _updateNotifBadge(_notifCombinedUnread());
}

/** Snapshot crossed stale threshold — one client notification per episode until data is fresh again. */
function _maybeNotifySnapshotStale(effectivelyStale) {
  if (!effectivelyStale) {
    _staleDataNotifEpisodeShown = false;
    return;
  }
  if (_topCollectActive) return;
  if (_staleDataNotifEpisodeShown) return;
  _staleDataNotifEpisodeShown = true;

  const list = document.getElementById('notif-list');
  if (!list) return;

  list.querySelectorAll('.notif-item[data-client-kind="stale-data"]').forEach((el) => el.remove());

  const item = {
    level: 'warn',
    title: t('dash.stale_data_notif_title'),
    detail: t('dash.stale_data_notif_detail'),
    ts: Date.now(),
    clientKind: 'stale-data',
  };
  const wasEmpty = list.querySelector('.notif-empty');
  if (wasEmpty) list.innerHTML = '';
  list.insertAdjacentHTML('afterbegin', _renderNotifItem(item));

  const panel = document.getElementById('notif-panel');
  if (panel && !panel.classList.contains('open')) {
    _notifClientExtraUnread = 1;
    _syncNotifBadgeFromState();
  }

  showToast(t('dash.stale_data_notif_detail'), 'warn');
}

function toggleNotifPanel() {
  const p = document.getElementById('notif-panel');
  p.classList.toggle('open');
  if (p.classList.contains('open')) {
    _notifSeen = _notifMaxId;
    _notifClientExtraUnread = 0;
    _updateNotifBadge(0);
  }
  // Close when clicking outside
  if (p.classList.contains('open')) {
    setTimeout(() => {
      document.addEventListener('click', _notifOutsideClick, {once: true});
    }, 0);
  }
}

function _notifOutsideClick(e) {
  const p = document.getElementById('notif-panel');
  const btn = document.getElementById('notif-btn');
  if (!p || p.contains(e.target) || btn.contains(e.target)) return;
  p.classList.remove('open');
}

function _updateNotifBadge(count) {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
  }
}

function clearNotifications() {
  const list = document.getElementById('notif-list');
  if (list) list.innerHTML = '<div class="notif-empty">No state-change events yet</div>';
  _notifMaxId = 0; _notifSeen = 0;
  _notifClientExtraUnread = 0;
  _staleDataNotifEpisodeShown = false;
  _updateNotifBadge(0);
}

function _renderNotifItem(n) {
  const levelClass = n.level === 'ok' ? 'ok' : n.level === 'warn' ? 'warn' : 'error';
  const ts = n.ts ? new Date(n.ts).toLocaleTimeString() : '';
  const link = n.url ? ` <a href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener" style="font-size:.72rem">&#8599;</a>` : '';
  const dk = n.clientKind ? ` data-client-kind="${esc(n.clientKind)}"` : '';
  return `<div class="notif-item"${dk}>
    <div class="notif-dot ${levelClass}"></div>
    <div class="notif-item-body">
      <div class="notif-item-title">${esc(n.title)}${link}</div>
      <div class="notif-item-detail">${esc(n.detail || '')}</div>
    </div>
    <div class="notif-item-ts">${ts}</div>
  </div>`;
}

async function pollNotifications() {
  const res = await fetch(apiUrl(`api/notifications?since_id=${_notifMaxId}`)).catch(() => null);
  if (!res || !res.ok) return;
  const data = await res.json();
  if (!data.items || !data.items.length) return;

  const list = document.getElementById('notif-list');
  const panel = document.getElementById('notif-panel');
  const wasEmpty = list.querySelector('.notif-empty');

  if (wasEmpty) list.innerHTML = '';

  data.items.forEach(n => {
    list.insertAdjacentHTML('afterbegin', _renderNotifItem(n));
    if (n.id > _notifMaxId) _notifMaxId = n.id;
  });

  const newCount = _notifCombinedUnread();
  if (newCount > 0 && !panel.classList.contains('open')) {
    _updateNotifBadge(newCount);
    // Show a toast for each new critical notification
    data.items.filter(n => n.level === 'error').forEach(n => {
      showToast(n.title, 'err');
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Favourites (starred builds, stored in localStorage)
// ─────────────────────────────────────────────────────────────────────────────
const FAV_KEY = 'cimon-favourites';
let _favBuilds = {};   // job_name -> build object

function _favDecodeJobAttr(enc) {
  try { return decodeURIComponent(enc || ''); } catch { return ''; }
}

/** Favourite toggle from builds table (avoids broken onclick HTML when job_name is a string). */
function toggleFavBtn(btn) {
  if (!btn) return;
  const jobName = _favDecodeJobAttr(btn.getAttribute('data-fav-job'));
  if (!jobName) return;
  let buildData = null;
  const pl = btn.getAttribute('data-fav-payload');
  if (pl) {
    try { buildData = JSON.parse(_favDecodeJobAttr(pl)); } catch { buildData = { job_name: jobName }; }
  }
  // Immediate visual feedback on the clicked button (even if storage/UI refresh fails).
  const was = btn.classList.contains('starred');
  try { toggleFav(jobName, buildData); }
  catch {
    btn.classList.toggle('starred', !was);
    btn.title = !was ? t('dash.fav_remove') : t('dash.fav_add');
  }
}

function _loadFavKeys() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '{}'); }
  catch { return {}; }
}

function _saveFavKeys(obj) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(obj)); } catch { /* ignore */ }
}

function toggleFav(jobName, buildData) {
  const k = String(jobName ?? '');
  const keys = _loadFavKeys();
  if (keys[k]) {
    delete keys[k];
    showToast(tf('dash.fav_removed_toast', { name: k }), 'ok');
  } else {
    keys[k] = buildData || { job_name: k };
    showToast(tf('dash.starred_toast', { name: k }), 'ok');
  }
  _saveFavKeys(keys);
  _renderFavPanel();
  // Update star buttons visible in builds table
  document.querySelectorAll('.fav-btn[data-fav-job]').forEach((btn) => {
    const jn = _favDecodeJobAttr(btn.getAttribute('data-fav-job'));
    btn.classList.toggle('starred', !!keys[jn]);
    btn.title = keys[jn] ? t('dash.fav_remove') : t('dash.fav_add');
  });
}

function _buildFavRow(b) {
  const src = (b.source || '').toLowerCase();
  let actionBtn = '';
  if (src === 'jenkins') {
    actionBtn = `<button class="act-btn" data-dash-action="triggerJenkinsBuild" data-dash-args='[${JSON.stringify(b.job_name)},${JSON.stringify(jenkinsBaseFromBuildUrl(b.url))}]'>&#9654; ${esc(t('dash.act_run'))}</button>`;
  } else if (src === 'gitlab') {
    const ref = b.branch || 'main';
    const glUrl = gitlabBaseFromPipelineUrl(b.url);
    actionBtn = `<button class="act-btn" data-dash-action="triggerGitlabPipeline" data-dash-args='[${JSON.stringify(b.job_name)},${JSON.stringify(ref)},${JSON.stringify(glUrl)}]'>&#9654; ${esc(t('dash.act_run'))}</button>`;
  }
  const ctx = _fmtBuildContext(_jobAnalytics[b.job_name]);
  const jt = _svgTitleAttr(b.job_name);
  const bt = _svgTitleAttr(b.branch || '');
  const cpyTitle = _svgTitleAttr(t('dash.copy_id_title'));
  const bn = b.build_number;
  const numHtml = (bn != null && bn !== '')
    ? `<span class="num-copy-wrap"><span>${esc(String(bn))}</span><button type="button" class="btn-copy-ref" title="${cpyTitle}" aria-label="${cpyTitle}" onclick="copyBuildRef(event,${JSON.stringify(b.job_name)},${JSON.stringify(bn)})">&#128203;</button></span>`
    : '—';
  return `<tr data-fav-job="${esc(b.job_name)}" data-job="${encodeURIComponent(b.job_name)}">
    <td class="col-pin-star"><button type="button" class="fav-btn starred" data-fav-job="${encodeURIComponent(String(b.job_name ?? ''))}" onclick="toggleFavBtn(this)" title="${_svgTitleAttr(t('dash.fav_remove'))}">&#11088;</button></td>
    <td class="col-pin-src"><span class="b b-dim">${esc(b.source)}</span></td>
    <td class="col-pin-job" style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${jt}">
      ${b.critical ? `<strong>${esc(b.job_name)}</strong>` : esc(b.job_name)}
    </td>
    <td class="mono col-pin-num">${numHtml}</td>
    <td class="col-pin-st">${badge(b.status)}</td>
    <td class="mono context-cell col-compact-hide" style="font-size:.76rem;color:var(--muted);max-width:140px">${ctx}</td>
    <td class="mono col-compact-hide" style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${bt}">${esc(b.branch)}</td>
    <td style="white-space:nowrap">${fmt(b.started_at)}</td>
    <td class="td-duration" style="white-space:nowrap"><span class="dur-val">${dur(b.duration_seconds)}</span>${_sparkSVG(b.job_name, b.status)}</td>
    <td>${b.url ? `<a href="${esc(safeUrl(b.url))}" target="_blank" rel="noopener">&#8599;</a>` : '—'}</td>
    <td>${_buildLogCell(b)}</td>
    <td>${actionBtn}</td>
  </tr>`;
}

function _renderFavPanel() {
  const keys = _loadFavKeys();
  const panel = document.getElementById('panel-favourites');
  const tbody = document.getElementById('tbody-fav');
  const count = document.getElementById('fav-count');
  const entries = Object.values(keys);

  if (!panel) return;
  panel.classList.toggle('has-items', entries.length > 0);
  if (count) count.textContent = entries.length;

  if (!tbody) return;
  if (!entries.length) { tbody.innerHTML = ''; return; }
  tbody.innerHTML = entries.map(b => _buildFavRow(b)).join('');
  _applyGlobalSearch();
}

// ─────────────────────────────────────────────────────────────────────────────
// Time filter (hours) for builds
// ─────────────────────────────────────────────────────────────────────────────
let _buildsHours = 0;
let _testsHours = 0;
/** Top failures panel: 0 = whole snapshot, else last N days by test timestamp */
let _failuresDays = 0;
let _svcProblemsOnly = false;
let _persistedEvents = [];
let _lastSnap = null;
let _topAgeBaseSec = null;
let _topAgeBaseTs = 0;
let _topAgeStale = false;
let _topAgeTimer = null;
/** From /api/meta snapshot — used to detect stale age while meta is not re-polled (LIVE off). */
let _topStaleThresholdSec = null;
let _topCollectActive = false;

function _syncURLAndFilterSummary() {
  try { _writeURLFilters(); } catch { /* ignore */ }
  try { updateFilterSummary(); } catch { /* ignore */ }
}

function toggleTestsTimeFilter(hours) {
  const wasActive = _testsHours === hours;
  _testsHours = wasActive ? 0 : hours;
  ['tf-t-6h','tf-t-24h','tf-t-7d'].forEach((id) => document.getElementById(id)?.classList.remove('active'));
  if (!wasActive) {
    const id = hours === 6 ? 'tf-t-6h' : hours === 24 ? 'tf-t-24h' : 'tf-t-7d';
    document.getElementById(id)?.classList.add('active');
  }
  try { localStorage.setItem('cimon-tests-hours', String(_testsHours)); } catch {}
  updateFilterSummary();
  resetFailures();
  resetTests();
}

function setTestSourceQuick(v) {
  const sel = document.getElementById('f-tsource');
  if (!sel) return;
  sel.value = v;
  updateTestsExportLinks();
  _syncTestSourceQuickButtons();
  resetFailures();
  resetTests();
}

function _syncTestSourceQuickButtons() {
  const v = document.getElementById('f-tsource')?.value || '';
  const b1 = document.getElementById('tsrc-real');
  const b2 = document.getElementById('tsrc-synth');
  if (b1) b1.classList.toggle('lv-active', v === 'real');
  if (b2) b2.classList.toggle('lv-active', v === 'synthetic');
}

function toggleTimeFilter(hours) {
  const wasActive = _buildsHours === hours;
  _buildsHours = wasActive ? 0 : hours;

  document.querySelectorAll('.time-filter-btn').forEach(b => b.classList.remove('active'));
  if (!wasActive) {
    const id = hours === 24 ? 'tf-24h' : 'tf-7d';
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }
  try {
    localStorage.setItem('cimon-builds-hours', String(_buildsHours));
  } catch { /* ignore */ }
  updateFilterSummary();
  resetBuilds();
}

function applyBuildPreset(preset) {
  if (preset === 'failed24') {
    document.getElementById('f-bstatus').value = 'failure';
    _buildsHours = 24;
    document.querySelectorAll('.time-filter-btn').forEach((b) => b.classList.remove('active'));
    document.getElementById('tf-24h')?.classList.add('active');
    try { localStorage.setItem('cimon-builds-hours', '24'); } catch { /* ignore */ }
    resetBuilds();
    updateFilterSummary();
    goToInTab('builds', 'panel-builds');
  } else if (preset === 'starred') {
    document.getElementById('f-source').value = '';
    document.getElementById('f-bstatus').value = '';
    document.getElementById('f-job').value = '';
    _buildsHours = 0;
    document.querySelectorAll('.time-filter-btn').forEach((b) => b.classList.remove('active'));
    try { localStorage.setItem('cimon-builds-hours', '0'); } catch { /* ignore */ }
    resetBuilds();
    updateFilterSummary();
    goToInTab('builds', 'panel-favourites');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export dropdown toggle
// ─────────────────────────────────────────────────────────────────────────────
function toggleExportMenu(wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const isOpen = wrap.classList.toggle('open');
  if (isOpen) {
    setTimeout(() => {
      document.addEventListener('click', function close(e) {
        if (!wrap.contains(e.target)) { wrap.classList.remove('open'); }
        document.removeEventListener('click', close);
      });
    }, 0);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Log viewer (Jenkins / GitLab / Docker + follow + search)
// ─────────────────────────────────────────────────────────────────────────────
let _logAbort = null;
let _logRawText = '';
let _logSearchQuery = '';
let _logLevelFilter = 'all';
let _logSearchRegex = false;
let _logIsStreaming = false;
let _logSearchTimer = null;
let _logStreamRenderTimer = null;

function _onLogRegexToggle() {
  const el = document.getElementById('log-search-regex');
  _logSearchRegex = !!(el && el.checked);
  _renderLogLines();
}

function _escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _setLogText(text) {
  _logRawText = text || '';
  _logIsStreaming = false;
  _renderLogLines();
}

function _appendLogChunk(chunk) {
  _logRawText += chunk;
  clearTimeout(_logStreamRenderTimer);
  _logStreamRenderTimer = setTimeout(() => {
    const pre = document.getElementById('log-modal-pre');
    if (!pre) return;
    if (!_logSearchQuery && _logLevelFilter === 'all') {
      // Fast path during streaming — plain text, no re-parse
      pre.textContent = _logRawText;
      if (_isLogAutoScrollEnabled()) pre.scrollTop = pre.scrollHeight;
    } else {
      _renderLogLines();
    }
  }, 250);
}

function _isLogAutoScrollEnabled() {
  const follow = document.getElementById('log-follow');
  return !!(follow && follow.checked);
}

function _getDockerLogTail() {
  const tailEnabledEl = document.getElementById('log-tail-enabled');
  const tailLinesEl = document.getElementById('log-tail-lines');
  const tailEnabled = !tailEnabledEl || !!tailEnabledEl.checked;
  if (!tailEnabled) return 50000;
  let tail = parseInt((tailLinesEl && tailLinesEl.value) || '1000', 10);
  if (!Number.isFinite(tail)) tail = 1000;
  tail = Math.max(100, Math.min(50000, tail));
  if (tailLinesEl) tailLinesEl.value = String(tail);
  return tail;
}

function _renderLogLines() {
  const pre = document.getElementById('log-modal-pre');
  if (!pre) return;
  const qRaw = (_logSearchQuery || '').trim();
  const q = qRaw.toLowerCase();
  const lvl = _logLevelFilter;
  const NOISE_404 = [
    'http://127.0.0.1:8000/api/collect/status',
    'http://127.0.0.1:8000/api/notifications?since_id=0',
  ];

  // Fast path: no filters and large log → plain text
  if (!q && lvl === 'all' && _logRawText.length > 400000) {
    pre.textContent = _logRawText;
    if (_isLogAutoScrollEnabled()) pre.scrollTop = pre.scrollHeight;
    const cnt = document.getElementById('log-search-count');
    if (cnt) cnt.textContent = '';
    return;
  }

  const lines = _logRawText.split('\n');
  const parts = [];
  let matchCount = 0;

  const ERR_RE = /\b(error|exception|fail(?:ed|ure)?|fatal|critical|traceback)\b/i;
  const WARN_RE = /\b(warn(?:ing)?|deprecated)\b/i;
  const INFO_RE = /\b(info|debug|verbose|trace)\b/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLower = line.toLowerCase();
    // Hide noisy internal poll 404s (common when app isn't bound on 127.0.0.1 inside container).
    if (lineLower.includes('http исключение 404') && NOISE_404.some(u => lineLower.includes(u))) continue;

    if (lvl !== 'all') {
      const isErr = ERR_RE.test(line);
      const isWarn = WARN_RE.test(line);
      const isInfo = INFO_RE.test(line);
      if (lvl === 'error' && !isErr) continue;
      if (lvl === 'warn' && !isWarn && !isErr) continue;
      if (lvl === 'info' && !isInfo && !isWarn && !isErr) continue;
    }

    if (qRaw) {
      if (_logSearchRegex) {
        let re;
        try { re = new RegExp(qRaw); } catch { continue; }
        if (!re.test(line)) continue;
      } else if (!lineLower.includes(q)) {
        continue;
      }
    }

    const isErr = ERR_RE.test(line);
    const isWarn = WARN_RE.test(line);
    const cls = isErr ? 'log-line-err' : isWarn ? 'log-line-warn' : '';

    let escaped = _escHtml(line);

    if (qRaw) {
      if (_logSearchRegex) {
        matchCount++;
        try {
          const reHl = new RegExp(qRaw, 'g');
          let m;
          const pieces = [];
          let last = 0;
          let any = false;
          while ((m = reHl.exec(line)) !== null) {
            any = true;
            pieces.push(_escHtml(line.slice(last, m.index)));
            pieces.push('<mark class="log-hl">' + _escHtml(m[0]) + '</mark>');
            last = m.index + m[0].length;
            if (m[0].length === 0) reHl.lastIndex++;
          }
          pieces.push(_escHtml(line.slice(last)));
          if (any) escaped = pieces.join('');
        } catch { /* keep plain escaped line */ }
      } else {
        matchCount++;
        const qEscHtml = _escHtml(qRaw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        escaped = escaped.replace(new RegExp(qEscHtml, 'gi'), m => `<mark class="log-hl">${m}</mark>`);
      }
    }

    parts.push(cls ? `<span class="${cls}">${escaped}</span>\n` : `${escaped}\n`);
  }

  pre.innerHTML = parts.length
    ? parts.join('')
    : `<span style="color:var(--muted)">(no lines match filter)</span>`;

  const cnt = document.getElementById('log-search-count');
  if (cnt) cnt.textContent = qRaw ? `${matchCount} match${matchCount !== 1 ? 'es' : ''}` : '';

  if (_isLogAutoScrollEnabled()) pre.scrollTop = pre.scrollHeight;

  // Scroll first match into view
  if (qRaw) {
    const mark = pre.querySelector('mark.log-hl');
    if (mark) mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function _onLogSearch(val) {
  clearTimeout(_logSearchTimer);
  _logSearchTimer = setTimeout(() => {
    _logSearchQuery = val;
    _renderLogLines();
  }, 200);
}

function setLogLevel(lvl) {
  _logLevelFilter = lvl;
  // Only buttons inside the log modal (same class is reused for Tests "Real/Jobs" toggles).
  document.querySelectorAll('#log-modal .log-lvl-btn[data-level]').forEach((b) => {
    b.classList.remove('lv-active', 'lv-active-err', 'lv-active-warn');
    if (b.dataset.level === lvl) {
      b.classList.add(lvl === 'error' ? 'lv-active-err' : lvl === 'warn' ? 'lv-active-warn' : 'lv-active');
    }
  });
  _renderLogLines();
}

function _resetLogSearch() {
  _logRawText = '';
  _logSearchQuery = '';
  _logLevelFilter = 'all';
  _logSearchRegex = false;
  _logIsStreaming = false;
  clearTimeout(_logSearchTimer);
  clearTimeout(_logStreamRenderTimer);
  const inp = document.getElementById('log-search-input');
  if (inp) inp.value = '';
  const rx = document.getElementById('log-search-regex');
  if (rx) rx.checked = false;
  const cnt = document.getElementById('log-search-count');
  if (cnt) cnt.textContent = '';
  document.querySelectorAll('#log-modal .log-lvl-btn[data-level]').forEach((b) => {
    b.classList.remove('lv-active', 'lv-active-err', 'lv-active-warn');
    if (b.dataset.level === 'all') b.classList.add('lv-active');
  });
}

function copyLogToClipboard() {
  navigator.clipboard.writeText(_logRawText).then(
    () => showToast(t('dash.copy_log_toast'), 'ok'),
    () => showToast(t('dash.copy_log_fail'), 'err')
  );
}

function _formatLogFetchError(r, data, rawText) {
  const d = data && data.detail;
  if (r.status === 404) {
    if (d === 'Not Found' || d === undefined) {
      return 'HTTP 404 «Not Found»: запрос ушёл не на тот URL (часто из-за абсолютного пути /api при открытии дашборда не с корня сайта). Обновите страницу (Ctrl+F5). Если за nginx — location должен проксировать тот же префикс, что и у страницы (например /monitor/api/…).';
    }
    if (typeof d === 'string' && d.indexOf('Container not found') === 0) {
      return d + '\n\nПодсказка: веб-сервис и collect должны использовать один и тот же Docker (см. docker ps -a). Имя в таблице могло устареть — нажмите Collect.';
    }
  }
  if (typeof d === 'string') return d;
  if (d !== undefined && d !== null) return JSON.stringify(d);
  return (rawText && rawText.slice(0, 600)) || r.statusText || 'Unknown error';
}

function stopLogStream() {
  if (_logAbort) {
    try { _logAbort.abort(); } catch (e) { /* ignore */ }
    _logAbort = null;
  }
  _logIsStreaming = false;
}

async function loadJenkinsLogsIntoModal(p) {
  const q = new URLSearchParams({ job_name: p.job_name, build_number: String(p.build_number) });
  if (p.instance_url) q.set('instance_url', p.instance_url);
  _setLogText(t('dash.log_fetching'));
  const r = await fetch(apiUrl('api/logs/jenkins?' + q.toString()));
  const rawText = await r.text();
  let data = {};
  try { data = JSON.parse(rawText); } catch { /* not JSON */ }
  _setLogText(r.ok ? (data.log || t('dash.log_empty')) : t('dash.log_error_prefix') + _formatLogFetchError(r, data, rawText));
}

async function loadGitlabLogsIntoModal(p) {
  const q = new URLSearchParams({ project_id: p.project_id, pipeline_id: String(p.pipeline_id) });
  if (p.instance_url) q.set('instance_url', p.instance_url);
  _setLogText(t('dash.log_fetching'));
  const r = await fetch(apiUrl('api/logs/gitlab?' + q.toString()));
  const rawText = await r.text();
  let data = {};
  try { data = JSON.parse(rawText); } catch { /* not JSON */ }
  _setLogText(r.ok ? (data.log || t('dash.log_empty')) : t('dash.log_error_prefix') + _formatLogFetchError(r, data, rawText));
}

async function loadDockerLogsIntoModal(container) {
  const params = (typeof container === 'object' && container) ? container : { container };
  const name = String(params.container || '').trim();
  const host = String(params.docker_host || '').trim();
  stopLogStream();
  _setLogText(t('dash.log_fetching'));
  _logAbort = new AbortController();
  const dec = new TextDecoder('utf-8');
  const tail = _getDockerLogTail();
  const q = 'api/logs/docker/stream?container=' + encodeURIComponent(name) + '&follow=false&tail=' + encodeURIComponent(String(tail))
    + (host ? '&docker_host=' + encodeURIComponent(host) : '');
  const u = apiUrl(q);
  try {
    const r = await fetch(u, { signal: _logAbort.signal });
    if (!r.ok) {
      const rawText = await r.text();
      let data = {};
      try { data = JSON.parse(rawText); } catch { /* not JSON */ }
      _setLogText(t('dash.log_error_prefix') + _formatLogFetchError(r, data, rawText));
      return;
    }
    const reader = r.body && r.body.getReader ? r.body.getReader() : null;
    if (!reader) {
      const rawText = await r.text();
      _setLogText(rawText || t('dash.log_empty'));
      return;
    }
    _logRawText = '';
    let started = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      if (!chunk) continue;
      if (!started) {
        started = true;
        _logRawText = chunk;
        _renderLogLines();
      } else {
        _appendLogChunk(chunk);
      }
    }
    const tail = dec.decode();
    if (tail) {
      if (!started) {
        started = true;
        _logRawText = tail;
        _renderLogLines();
      } else {
        _appendLogChunk(tail);
      }
    }
    clearTimeout(_logStreamRenderTimer);
    if (!started || _logRawText === '') {
      _setLogText(t('dash.log_empty'));
    } else {
      _renderLogLines();
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
    _setLogText(t('dash.log_error_prefix') + (e.message || String(e)));
  } finally {
    _logAbort = null;
  }
}

async function startDockerLogStream(container, dockerHost = '') {
  stopLogStream();
  const dec = new TextDecoder();
  _logAbort = new AbortController();
  _logIsStreaming = true;
  const tail = _getDockerLogTail();
  try {
    const res = await fetch(
      apiUrl('api/logs/docker/stream?container=' + encodeURIComponent(container) + '&follow=true&tail=' + encodeURIComponent(String(tail))
        + (dockerHost ? '&docker_host=' + encodeURIComponent(dockerHost) : '')),
      { signal: _logAbort.signal }
    );
    if (!res.ok) {
      const t0 = await res.text();
      let errData = {};
      try { errData = JSON.parse(t0); } catch { /* */ }
      _logIsStreaming = false;
      _setLogText(_logRawText + '\n[stream error] ' + _formatLogFetchError(res, errData, t0));
      return;
    }
    const reader = res.body.getReader();
    _logRawText += '\n--- live stream ---\n';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      _appendLogChunk(dec.decode(value, { stream: true }));
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      _logRawText += '\n[stream stopped] ' + e.message;
    }
  }
  _logIsStreaming = false;
  _renderLogLines();
}

let _logModalPrevFocus = null;

async function openLogViewer(kind, params) {
  const ov = document.getElementById('log-modal');
  const title = document.getElementById('log-modal-title');
  if (!ov || !title) return;

  _logModalPrevFocus = document.activeElement;
  stopLogStream();
  _resetLogSearch();
  const followChk = document.getElementById('log-follow');
  const tailEnabled = document.getElementById('log-tail-enabled');
  const tailLines = document.getElementById('log-tail-lines');
  if (followChk) {
    followChk.checked = false;
    followChk.onchange = null;
  }
  const followWrap = document.getElementById('log-follow-wrap');
  const tailControls = document.getElementById('log-tail-controls');
  const btnRef = document.getElementById('log-btn-refresh');

  if (tailEnabled && tailLines) {
    const syncTailUi = () => {
      tailLines.disabled = !tailEnabled.checked;
    };
    syncTailUi();
    tailEnabled.onchange = syncTailUi;
  }

  if (kind === 'docker') {
    title.textContent = 'Docker: ' + (params.container || '');
    if (followWrap) followWrap.classList.add('visible');
    if (tailControls) tailControls.style.display = 'inline-flex';
    const running = (params.status || '').toLowerCase() === 'up';
    if (followChk) {
      followChk.disabled = !running;
      followChk.title = running ? t('dash.log_follow_on') : t('dash.log_follow_off');
    }
    if (btnRef) btnRef.style.display = '';
    if (btnRef) btnRef.onclick = () => {
      stopLogStream();
      if (followChk) followChk.checked = false;
      loadDockerLogsIntoModal(params);
    };
    _setLogText(t('dash.log_fetching'));
    ov.classList.add('open');
    ov.setAttribute('aria-hidden', 'false');
    if (followChk) {
      followChk.onchange = () => {
        if (followChk.checked) {
          const pre = document.getElementById('log-modal-pre');
          if (pre) pre.scrollTop = pre.scrollHeight;
          startDockerLogStream(params.container, params.docker_host || '');
        }
        else stopLogStream();
      };
    }
    await loadDockerLogsIntoModal(params);
  } else {
    if (followWrap) followWrap.classList.remove('visible');
    if (tailControls) tailControls.style.display = 'none';
    if (btnRef) btnRef.style.display = '';
    if (kind === 'jenkins') {
      title.textContent = 'Jenkins: ' + params.job_name + ' #' + params.build_number;
      btnRef.onclick = () => loadJenkinsLogsIntoModal(params);
    } else {
      title.textContent = 'GitLab: ' + params.project_id + ' #' + params.pipeline_id;
      btnRef.onclick = () => loadGitlabLogsIntoModal(params);
    }
    _setLogText(t('dash.log_fetching'));
    ov.classList.add('open');
    ov.setAttribute('aria-hidden', 'false');
    if (kind === 'jenkins') await loadJenkinsLogsIntoModal(params);
    else await loadGitlabLogsIntoModal(params);
  }
  setTimeout(() => {
    document.querySelector('#log-modal .log-modal-header button')?.focus();
  }, 0);
}

function closeLogModal() {
  stopLogStream();
  _resetLogSearch();
  const lf = document.getElementById('log-follow');
  if (lf) lf.checked = false;
  const ov = document.getElementById('log-modal');
  if (ov) { ov.classList.remove('open'); ov.setAttribute('aria-hidden', 'true'); }
  const prev = _logModalPrevFocus;
  _logModalPrevFocus = null;
  if (prev && typeof prev.focus === 'function') {
    try { prev.focus(); } catch (_e) { /* ignore */ }
  }
}

