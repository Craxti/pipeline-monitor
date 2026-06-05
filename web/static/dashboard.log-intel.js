// Container log intelligence: clustering, correlation graph — dashboard.log-intel.js

function _liT(key, fallback) {
  try {
    return typeof t === 'function' ? t(key) : fallback;
  } catch {
    return fallback;
  }
}

function _liRoleLabel(role) {
  if (role === 'root') return _liT('dash.log_intel_role_root', 'Root');
  if (role === 'hub') return _liT('dash.log_intel_role_hub', 'Hub');
  if (role === 'leaf') return _liT('dash.log_intel_role_leaf', 'Leaf');
  return _liT('dash.log_intel_role_normal', 'Node');
}

function _liRoleClass(role) {
  if (role === 'root') return 'lintel-role-root';
  if (role === 'hub') return 'lintel-role-hub';
  if (role === 'leaf') return 'lintel-role-leaf';
  return 'lintel-role-normal';
}

function _liEdgeColor(kind) {
  if (kind === 'out') return { color: '#34d399', highlight: '#6ee7b7', hover: '#6ee7b7' };
  if (kind === 'in') return { color: '#fbbf24', highlight: '#fcd34d', hover: '#fcd34d' };
  if (kind === 'dim') return { color: 'rgba(100,116,139,.22)', highlight: '#64748b', hover: '#64748b' };
  return { color: 'rgba(148,163,184,.42)', highlight: '#93c5fd', hover: '#93c5fd' };
}

function _liNodeStyle(n) {
  let fill = '#2563eb';
  let border = '#60a5fa';
  if (n.role === 'root') { fill = '#15803d'; border = '#4ade80'; }
  else if (n.role === 'hub') { fill = '#b45309'; border = '#fbbf24'; }
  else if (n.role === 'leaf') { fill = '#4338ca'; border = '#818cf8'; }
  if (n.level === 'error') { fill = '#b91c1c'; border = '#f87171'; }
  else if (n.level === 'warn' && n.role === 'normal') { fill = '#a16207'; border = '#facc15'; }
  const count = Number(n.count || 0);
  const inDeg = Number(n.in_degree || 0);
  const outDeg = Number(n.out_degree || 0);
  const short = String(n.label || n.id || '').replace(/\s+/g, ' ').trim();
  const line = short.length > 36 ? `${short.slice(0, 34)}…` : short;
  const degLine = `↙${inDeg}  ↗${outDeg}`;
  const label = count > 0 ? `×${count}\n${degLine}\n${line}` : `${degLine}\n${line}`;
  return {
    id: n.id,
    label,
    title: [
      _liRoleLabel(n.role),
      short,
      `${_liT('dash.log_intel_node_links', 'Links')}: ↙${inDeg} ${_liT('dash.log_intel_node_in', 'incoming')} · ↗${outDeg} ${_liT('dash.log_intel_node_out', 'outgoing')}`,
      `count: ${count}`,
    ].join('\n'),
    shape: 'box',
    margin: 14,
    widthConstraint: { minimum: 108, maximum: 240 },
    color: {
      background: fill,
      border,
      highlight: { background: fill, border: '#f8fafc' },
      hover: { background: fill, border: '#f8fafc' },
    },
    font: { color: '#f8fafc', size: 13, face: 'ui-sans-serif, system-ui, sans-serif', multi: true, vadjust: 0 },
    borderWidth: 2,
    shadow: false,
  };
}

let _logIntelCorrView = 'graph';
let _logIntelSelectedNodeId = '';
let _logIntelCorrRaw = null;
let _logIntelGraphSimplified = false;
let _logIntelWatch = false;
let _logIntelLiveTimer = null;
let _logIntelLiveSig = '';
let _logIntelLayoutPositions = null;
const _LI_LAYOUT_PREFIX = 'cimon-lintel-layout:';

function initLogIntelBindings() {
  const watch = document.getElementById('log-intel-watch');
  if (watch && !watch._liBound) {
    watch._liBound = true;
    watch.addEventListener('change', () => toggleLogIntelWatch());
  }
}

function openLogIntelTab(key) {
  setDashboardTab('log-intel');
  if (key) openLogIntelDetail(key);
  else loadLogIntelList();
}

async function loadLogIntelList() {
  const now = Date.now();
  if (now - _logIntelPollTs < 2000) return;
  _logIntelPollTs = now;
  const tbody = document.getElementById('tbody-log-intel');
  if (!tbody) return;
  const res = await fetch(apiUrl('api/log-intel/containers')).catch(() => null);
  if (!res || !res.ok) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">${esc(_liT('dash.table_api_err', 'API error'))}</td></tr>`;
    return;
  }
  const data = await res.json();
  const items = data.items || [];
  const cnt = document.getElementById('log-intel-count');
  if (cnt) cnt.textContent = String(items.length);
  if (!items.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">${esc(_liT('dash.log_intel_empty', 'No Docker containers in snapshot. Run Collect.'))}</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map((it) => {
    const itemKey = String(it.key || `${it.docker_host || ''}::${it.container || ''}`);
    const keyArg = JSON.stringify(itemKey);
    const trained = it.last_trained_at ? fmt(it.last_trained_at) : '—';
    const ready = it.model_ready ? '' : ' <span class="muted">(warming)</span>';
    const pin = it.watched
      ? `<span class="lintel-pin" title="${esc(_liT('dash.log_intel_watched_badge', 'Saved model'))}"></span>`
      : '';
    return `<tr>
      <td>${pin}<strong>${esc(it.container)}</strong>${it.docker_host ? `<div class="muted" style="font-size:.72rem">${esc(it.docker_host)}</div>` : ''}</td>
      <td>${badge(it.status || 'unknown')}</td>
      <td class="mono">${esc(String(it.clusters ?? 0))}</td>
      <td class="mono">${esc(String(it.events ?? 0))}</td>
      <td style="font-size:.78rem">${trained}${ready}</td>
      <td style="text-align:right">
        <button type="button" class="btn btn-ghost" style="font-size:.76rem" data-dash-action="openLogIntelDetail" data-dash-args='[${keyArg}]'>${_liT('dash.log_intel_open', 'Open')}</button>
      </td>
    </tr>`;
  }).join('');
}

function refreshLogIntelList() {
  _logIntelPollTs = 0;
  if (_logIntelSelectedKey) loadLogIntelDetail(_logIntelSelectedKey);
  else loadLogIntelList();
}

async function openLogIntelDetail(key) {
  key = String(key || '').trim();
  if (!key || !key.includes('::')) {
    if (typeof showToast === 'function') {
      showToast(_liT('dash.log_intel_open_err', 'Could not open container — missing key'), 'err');
    }
    return;
  }
  setDashboardTab('log-intel');
  _logIntelSelectedKey = key;
  _logIntelSelectedNodeId = '';
  _logIntelCorrView = 'graph';
  _logIntelGraphSimplified = false;
  const listPanel = document.getElementById('panel-log-intel-list');
  const detailPanel = document.getElementById('panel-log-intel-detail');
  if (listPanel) listPanel.hidden = true;
  if (detailPanel) detailPanel.hidden = false;
  _liShowDetailLoading(true);
  try {
    await loadLogIntelDetail(key);
  } finally {
    _liShowDetailLoading(false);
  }
}

function _liShowDetailLoading(on) {
  const panel = document.getElementById('panel-log-intel-detail');
  if (!panel) return;
  panel.classList.toggle('lintel-detail-loading', !!on);
}

function closeLogIntelDetail() {
  _logIntelSelectedKey = '';
  _logIntelSelectedNodeId = '';
  _logIntelCorrData = null;
  _logIntelCorrRaw = null;
  _logIntelGraphSimplified = false;
  _logIntelWatch = false;
  _logIntelLiveSig = '';
  _liStopLiveRefresh();
  const listPanel = document.getElementById('panel-log-intel-list');
  const detailPanel = document.getElementById('panel-log-intel-detail');
  if (listPanel) listPanel.hidden = false;
  if (detailPanel) detailPanel.hidden = true;
  if (_logIntelGraph) {
    try { _logIntelGraph.destroy(); } catch { /* ignore */ }
    _logIntelGraph = null;
  }
  _liUpdateNodeInspector(null);
  loadLogIntelList();
}

function _liFocusGraphNode(id, opts) {
  opts = opts || {};
  if (!id || !_logIntelGraph) return;
  try {
    if (!_logIntelGraph.body.data.nodes.get(String(id))) {
      if (typeof showToast === 'function') {
        showToast(_liT('dash.log_intel_node_hidden', 'Not shown in current graph view — disable simplify or pick another cluster'), 'warn');
      }
      return;
    }
  } catch { /* ignore */ }
  if (_logIntelCorrView !== 'graph') setLogIntelCorrView('graph');
  _liSelectGraphNode(id, { flashCluster: opts.flashCluster !== false });
  try {
    _logIntelGraph.selectNodes([id]);
    if (opts.zoom !== true) return;
    const positions = _logIntelGraph.getPositions([id]);
    const pos = positions[id];
    if (!pos) return;
    const scale = _logIntelGraph.getScale();
    const el = document.getElementById('log-intel-graph');
    const cx = el ? el.clientWidth / 2 : 0;
    const cy = el ? el.clientHeight / 2 : 0;
    _logIntelGraph.moveTo({
      position: { x: cx - pos.x * scale, y: cy - pos.y * scale },
      scale,
      animation: false,
    });
  } catch { /* ignore */ }
}

function _liSelectGraphNode(nodeId, opts) {
  opts = opts || {};
  _logIntelSelectedNodeId = nodeId ? String(nodeId) : '';
  _liApplyGraphSelection(_logIntelSelectedNodeId);
  if (opts.flashCluster !== false) _liMarkSelectedCluster(_logIntelSelectedNodeId);
  const nodes = _liNodeMap(_logIntelCorrData || {});
  _liUpdateNodeInspector(nodes.get(_logIntelSelectedNodeId) || null);
}

function _liMarkSelectedCluster(nodeId) {
  const box = document.getElementById('log-intel-clusters');
  if (!box) return;
  box.querySelectorAll('[data-lintel-cluster-id]').forEach((row) => {
    row.classList.toggle('selected', !!nodeId && row.getAttribute('data-lintel-cluster-id') === nodeId);
  });
}

function _liUpdateNodeInspector(node) {
  const el = document.getElementById('log-intel-node-inspector');
  if (!el) return;
  if (!node) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const inDeg = Number(node.in_degree || 0);
  const outDeg = Number(node.out_degree || 0);
  const short = String(node.label || node.id || '').replace(/\s+/g, ' ').trim();
  el.hidden = false;
  el.innerHTML = `
    <div class="lintel-inspector-main">
      <span class="lintel-inspector-role ${_liRoleClass(node.role)}">${esc(_liRoleLabel(node.role))}</span>
      <span class="lintel-inspector-label" title="${esc(short)}">${esc(short)}</span>
    </div>
    <div class="lintel-inspector-stats">
      <span class="lintel-inspector-stat lintel-inspector-in" title="${esc(_liT('dash.log_intel_edge_in', 'Incoming'))}">↙ ${esc(String(inDeg))}</span>
      <span class="lintel-inspector-stat lintel-inspector-out" title="${esc(_liT('dash.log_intel_edge_out', 'Outgoing'))}">↗ ${esc(String(outDeg))}</span>
      <span class="lintel-inspector-stat">×${esc(String(node.count || 0))}</span>
    </div>`;
}

function _liApplyGraphSelection(nodeId) {
  if (!_logIntelGraph || !_logIntelCorrData) return;
  const edges = Array.isArray(_logIntelCorrData.edges) ? _logIntelCorrData.edges : [];
  const updates = edges.map((e, i) => {
    let kind = 'neutral';
    if (nodeId) {
      if (String(e.from) === nodeId) kind = 'out';
      else if (String(e.to) === nodeId) kind = 'in';
      else kind = 'dim';
    }
    return { id: `e${i}`, color: _liEdgeColor(kind) };
  });
  try { _logIntelGraph.body.data.edges.update(updates); } catch { /* ignore */ }
}

async function loadLogIntelDetail(key, opts) {
  opts = opts || {};
  key = String(key || _logIntelSelectedKey || '').trim();
  if (!key) return;
  const res = await fetch(apiUrl(`api/log-intel/containers/${encodeURIComponent(key)}`)).catch(() => null);
  if (!res || !res.ok) {
    if (typeof showToast === 'function') {
      showToast(_liT('dash.log_intel_load_err', 'Could not load log analysis'), 'err');
    }
    return;
  }
  const data = await res.json();
  if (!opts.skipTrain && Number(data.lines_ingested || 0) < 1) {
    await trainLogIntelContainer({ silent: true });
    return loadLogIntelDetail(key, { ...opts, skipTrain: true });
  }
  const sig = _liLiveSignature(data);
  if (opts.soft && sig === _logIntelLiveSig) {
    _liUpdateLiveStatus(data);
    return;
  }
  _logIntelLiveSig = sig;

  const title = document.getElementById('log-intel-detail-title');
  if (title) title.textContent = data.container || key;

  const pipe = document.getElementById('log-intel-pipeline');
  if (pipe && data.pipeline) {
    const p = data.pipeline;
    pipe.innerHTML = `
      <div class="lintel-step ${p.clustering?.status === 'ready' ? 'ready' : ''}">
        <div class="lintel-step-k">${_liT('dash.log_intel_step_cluster', '1. Clustering')}</div>
        <div class="lintel-step-v">${esc(String(p.clustering?.clusters ?? 0))} templates · ${esc(p.clustering?.status || '')}</div>
      </div>
      <div class="lintel-step ${p.correlation?.status === 'ready' ? 'ready' : ''}">
        <div class="lintel-step-k">${_liT('dash.log_intel_step_corr', '2. Correlation')}</div>
        <div class="lintel-step-v">${esc(String(p.correlation?.edges ?? 0))} edges · ${esc(p.correlation?.status || '')}</div>
      </div>`;
  }

  _logIntelWatch = !!data.watched;
  _liUpdateWatchUi(data);

  _logIntelCorrRaw = _liMergeClustersIntoCorr(data.correlation || {}, data.clusters || []);
  _logIntelGraphSimplified = false;
  _logIntelCorrData = _logIntelCorrRaw;
  const nodeMap = _liNodeMap(_logIntelCorrData);

  const clBox = document.getElementById('log-intel-clusters');
  if (clBox) {
    const clusters = data.clusters || [];
    clBox.innerHTML = clusters.length
      ? clusters.map((c) => {
        const nd = nodeMap.get(String(c.id || ''));
        const inDeg = nd ? Number(nd.in_degree || 0) : 0;
        const outDeg = nd ? Number(nd.out_degree || 0) : 0;
        const role = nd ? nd.role : 'normal';
        return `
        <div class="lintel-row" data-lintel-cluster-id="${esc(String(c.id || ''))}" title="${esc(c.template || '')}">
          <div class="lintel-row-top">
            <span class="badge ${c.level === 'error' ? 'fail' : c.level === 'warn' ? 'warn' : 'ok'}">${esc(c.level)}</span>
            <span class="lintel-role-pill ${_liRoleClass(role)}">${esc(_liRoleLabel(role))}</span>
            <span class="mono lintel-row-count">×${esc(String(c.count))}</span>
            <span class="lintel-row-deg" title="${esc(_liT('dash.log_intel_node_links', 'Links'))}">↙${esc(String(inDeg))} ↗${esc(String(outDeg))}</span>
          </div>
          <div class="lintel-tpl">${esc(c.template)}</div>
        </div>`;
      }).join('')
      : `<div class="muted lintel-list-empty">${esc(_liT('dash.log_intel_no_clusters', 'Not enough log data yet.'))}</div>`;
    clBox.querySelectorAll('[data-lintel-cluster-id]').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-lintel-cluster-id');
        if (!id) return;
        _liFocusGraphNode(id);
      });
    });
  }

  renderLogIntelCorrList(_logIntelCorrData);
  renderLogIntelGraph(_logIntelCorrData);
  setLogIntelCorrView(_logIntelCorrView || 'graph');
  _liUpdateSimplifyBtn();
  _liUpdateLiveStatus(data);

  const recent = document.getElementById('log-intel-recent');
  if (recent) {
    const evs = data.recent_events || [];
    recent.textContent = evs.map((e) => `${e.ts} [${e.level}] ${e.line}`).join('\n') || '—';
  }
}

function _liLiveSignature(data) {
  const p = data?.pipeline || {};
  return [
    data?.lines_ingested,
    data?.last_trained_at,
    p.clustering?.clusters,
    p.correlation?.edges,
  ].join('|');
}

function _liUpdateWatchUi(data) {
  const cb = document.getElementById('log-intel-watch');
  if (cb) cb.checked = !!data?.watched;
  _logIntelWatch = !!data?.watched;
  _liStartLiveRefresh();
}

function _liUpdateLiveStatus(data) {
  const el = document.getElementById('log-intel-live-status');
  if (!el) return;
  const clusters = data?.pipeline?.clustering?.clusters ?? 0;
  const edges = data?.pipeline?.correlation?.edges ?? 0;
  const events = data?.lines_ingested ?? 0;
  const trained = data?.last_trained_at ? fmt(data.last_trained_at) : '—';
  if (_logIntelWatch) {
    el.textContent = _liT(
      'dash.log_intel_live_watched',
      'Saved to disk · live learning · {events} events · {clusters} clusters · {edges} links · updated {trained}',
    )
      .replace('{events}', String(events))
      .replace('{clusters}', String(clusters))
      .replace('{edges}', String(edges))
      .replace('{trained}', trained);
    el.classList.add('lintel-live-on');
  } else {
    el.textContent = _liT(
      'dash.log_intel_live_bg',
      'Background learning from container logs · {events} events · updated {trained}. Enable save to keep the model after restart.',
    )
      .replace('{events}', String(events))
      .replace('{trained}', trained);
    el.classList.remove('lintel-live-on');
  }
}

function _liStartLiveRefresh() {
  _liStopLiveRefresh();
  if (!_logIntelSelectedKey || !_logIntelWatch) return;
  _logIntelLiveTimer = setInterval(() => {
    if (_logIntelSelectedKey && _logIntelWatch) {
      loadLogIntelDetail(_logIntelSelectedKey, { soft: true });
    }
  }, 20000);
}

function _liStopLiveRefresh() {
  if (_logIntelLiveTimer) {
    clearInterval(_logIntelLiveTimer);
    _logIntelLiveTimer = null;
  }
}

function _liLayoutStorageKey(key) {
  return `${_LI_LAYOUT_PREFIX}${String(key || '')}`;
}

function _liLoadLayoutFromStorage(key) {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(_liLayoutStorageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function _liSaveLayoutToStorage(key, positions) {
  if (!key || !positions) return;
  try {
    localStorage.setItem(_liLayoutStorageKey(key), JSON.stringify(positions));
  } catch { /* ignore */ }
}

function _liApplyStoredLayout(net) {
  if (!net) return;
  const positions = _logIntelLayoutPositions || _liLoadLayoutFromStorage(_logIntelSelectedKey);
  if (!positions) return;
  try {
    const ids = net.body.data.nodes.getIds();
    const updates = ids.map((id) => {
      const pos = positions[id];
      if (!pos) return null;
      return { id, x: pos.x, y: pos.y, fixed: { x: true, y: true } };
    }).filter(Boolean);
    if (updates.length) net.body.data.nodes.update(updates);
  } catch { /* ignore */ }
}

async function toggleLogIntelWatch() {
  const key = _logIntelSelectedKey;
  const cb = document.getElementById('log-intel-watch');
  if (!key || !cb) return;
  const want = !!cb.checked;
  cb.disabled = true;
  try {
    const res = await fetch(apiUrl(`api/log-intel/containers/${encodeURIComponent(key)}/watch`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watch: want }),
    }).catch(() => null);
    if (!res || !res.ok) {
      cb.checked = !want;
      if (typeof showToast === 'function') {
        showToast(_liT('dash.log_intel_watch_err', 'Could not update saved model setting'), 'err');
      }
      return;
    }
    _logIntelWatch = want;
    _liStartLiveRefresh();
    await loadLogIntelDetail(key);
    if (typeof showToast === 'function') {
      const msg = want
        ? _liT('dash.log_intel_watch_on', 'Model saved — graph will keep learning from new logs')
        : _liT('dash.log_intel_watch_off', 'Model no longer saved to disk');
      showToast(msg, 'ok');
    }
  } finally {
    cb.disabled = false;
  }
}

function _liNodeLabel(n) {
  const short = String(n.label || n.id || '').replace(/\s+/g, ' ').trim();
  return short.length > 56 ? `${short.slice(0, 54)}…` : short;
}

function _liNodeMap(corr) {
  const map = new Map();
  (corr.nodes || []).forEach((n) => {
    if (n && n.id) map.set(String(n.id), n);
  });
  return map;
}

/** Ensure every cluster template appears on the graph, not only transition endpoints. */
function _liMergeClustersIntoCorr(corr, clusters) {
  const nodes = Array.isArray(corr?.nodes) ? [...corr.nodes] : [];
  const edges = Array.isArray(corr?.edges) ? [...corr.edges] : [];
  const byId = _liNodeMap({ nodes });
  (clusters || []).forEach((c) => {
    const id = String(c?.id || '');
    if (!id || byId.has(id)) return;
    const tpl = String(c.template || id);
    byId.set(id, {
      id,
      label: tpl.length > 48 ? `${tpl.slice(0, 46)}…` : tpl,
      count: Number(c.count || 0),
      level: c.level || 'info',
      role: 'normal',
      in_degree: 0,
      out_degree: 0,
    });
  });
  return { nodes: [...byId.values()], edges };
}

/** Drop weak edges and low-signal nodes so the graph is easier to read. */
function _liSimplifyCorrelation(corr) {
  const nodes = Array.isArray(corr?.nodes) ? corr.nodes : [];
  const edges = Array.isArray(corr?.edges) ? [...corr.edges] : [];
  if (!edges.length) return { nodes, edges };

  const nodeMap = _liNodeMap({ nodes });
  edges.sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0));
  const topW = Number(edges[0]?.weight || 1);
  const minW = Math.max(2, Math.ceil(topW * 0.2));

  const keptEdges = edges.filter((e) => {
    const w = Number(e.weight || 0);
    if (w >= minW) return true;
    const fromN = nodeMap.get(String(e.from));
    const toN = nodeMap.get(String(e.to));
    return fromN?.level === 'error' || toN?.level === 'error' || fromN?.level === 'warn' || toN?.level === 'warn';
  }).slice(0, 80);

  const linked = new Set();
  keptEdges.forEach((e) => {
    linked.add(String(e.from));
    linked.add(String(e.to));
  });

  const keptNodes = nodes.filter((n) => {
    if (!n || !n.id || !linked.has(String(n.id))) return false;
    const level = String(n.level || 'info');
    const role = String(n.role || 'normal');
    const count = Number(n.count || 0);
    const deg = Number(n.in_degree || 0) + Number(n.out_degree || 0);
    if (level === 'error' || level === 'warn') return true;
    if (role === 'root' || role === 'hub') return true;
    if (count >= 3 || deg >= 2) return true;
    return false;
  });

  return { nodes: keptNodes.length ? keptNodes : nodes.slice(0, 48), edges: keptEdges.length ? keptEdges : edges.slice(0, 40) };
}

function _liUpdateSimplifyBtn() {
  const btn = document.getElementById('lintel-simplify-btn');
  if (!btn) return;
  btn.classList.toggle('active', !!_logIntelGraphSimplified);
  btn.textContent = _logIntelGraphSimplified
    ? _liT('dash.log_intel_show_all', 'Show all')
    : _liT('dash.log_intel_simplify', 'Simplify graph');
}

function toggleSimplifyLogIntelGraph() {
  if (!_logIntelCorrRaw) return;
  _logIntelGraphSimplified = !_logIntelGraphSimplified;
  _logIntelCorrData = _logIntelGraphSimplified
    ? _liSimplifyCorrelation(_logIntelCorrRaw)
    : _logIntelCorrRaw;
  _logIntelSelectedNodeId = '';
  _liMarkSelectedCluster('');
  _liUpdateNodeInspector(null);
  renderLogIntelCorrList(_logIntelCorrData);
  renderLogIntelGraph(_logIntelCorrData);
  setLogIntelCorrView('graph');
  _liUpdateSimplifyBtn();
  if (typeof showToast === 'function') {
    const msg = _logIntelGraphSimplified
      ? _liT('dash.log_intel_simplify_done', 'Weak links and noisy events hidden')
      : _liT('dash.log_intel_show_all_done', 'Full graph restored');
    showToast(msg, 'ok');
  }
}

function renderLogIntelCorrList(corr) {
  const box = document.getElementById('log-intel-corr-list');
  if (!box) return;
  const edges = Array.isArray(corr?.edges) ? [...corr.edges] : [];
  const nodes = _liNodeMap(corr || {});
  if (!edges.length) {
    box.innerHTML = `<div class="lintel-corr-empty muted">${esc(_liT('dash.log_intel_no_corr', 'Not enough correlated transitions yet.'))}</div>`;
    return;
  }
  edges.sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0));
  const rows = edges.map((e, i) => {
    const fromN = nodes.get(String(e.from));
    const toN = nodes.get(String(e.to));
    const fromLbl = fromN ? _liNodeLabel(fromN) : String(e.from || '—');
    const toLbl = toN ? _liNodeLabel(toN) : String(e.to || '—');
    const w = Number(e.weight || 0);
    const title = e.title || `${w} transitions`;
    return `<div class="lintel-corr-row" data-lintel-edge="${i}" title="${esc(title)}">
      <div class="lintel-corr-from" title="${esc(fromLbl)}">${esc(fromLbl)}</div>
      <div class="lintel-corr-arrow" aria-hidden="true">→</div>
      <div class="lintel-corr-to" title="${esc(toLbl)}">${esc(toLbl)}</div>
      <div class="lintel-corr-weight"><span class="lintel-corr-count">×${esc(String(w))}</span></div>
    </div>`;
  }).join('');
  box.innerHTML = `<div class="lintel-corr-table">${rows}</div>`;
  box.querySelectorAll('[data-lintel-edge]').forEach((row) => {
    row.addEventListener('click', () => {
      const idx = Number(row.getAttribute('data-lintel-edge'));
      const edge = edges[idx];
      if (!edge) return;
      _liFocusGraphNode(edge.from);
      try {
        if (_logIntelGraph) _logIntelGraph.selectNodes([edge.from, edge.to]);
      } catch { /* ignore */ }
    });
  });
}

function setLogIntelCorrView(view) {
  view = view === 'list' ? 'list' : 'graph';
  _logIntelCorrView = view;
  const listBtn = document.getElementById('lintel-view-list');
  const graphBtn = document.getElementById('lintel-view-graph');
  const listBox = document.getElementById('log-intel-corr-list');
  const graphWrap = document.getElementById('log-intel-graph-wrap');
  if (listBtn) listBtn.classList.toggle('active', view === 'list');
  if (graphBtn) graphBtn.classList.toggle('active', view === 'graph');
  if (listBox) listBox.hidden = view !== 'list';
  if (graphWrap) graphWrap.hidden = view !== 'graph';
  if (view === 'graph' && _logIntelGraph) {
    try { _logIntelGraph.redraw(); } catch { /* ignore */ }
  }
}

function _liGraphOptions(useHierarchical) {
  const opts = {
    physics: { enabled: false },
    interaction: {
      hover: true,
      tooltipDelay: 120,
      dragNodes: true,
      dragView: true,
      zoomView: false,
      keyboard: { enabled: false },
      multiselect: false,
      hideEdgesOnDrag: false,
      hideNodesOnDrag: false,
      selectable: true,
      navigationButtons: false,
    },
    edges: {
      smooth: { enabled: true, type: 'cubicBezier', roundness: 0.2, forceDirection: false },
      color: _liEdgeColor('neutral'),
      arrows: { to: { enabled: false } },
      font: { color: '#cbd5e1', size: 10, strokeWidth: 0, align: 'horizontal' },
      selectionWidth: 1,
    },
    nodes: {
      chosen: {
        node(values) {
          values.borderWidth = 3;
        },
      },
    },
    configure: { enabled: false },
  };
  if (useHierarchical) {
    opts.layout = {
      improvedLayout: true,
      hierarchical: {
        enabled: true,
        direction: 'UD',
        sortMethod: 'directed',
        levelSeparation: 150,
        nodeSpacing: 140,
        treeSpacing: 160,
        blockShifting: true,
        edgeMinimization: true,
        shakeTowards: 'roots',
      },
    };
  } else {
    opts.layout = { hierarchical: { enabled: false }, improvedLayout: false };
  }
  return opts;
}

function _liFinalizeStaticGraph(net) {
  if (!net) return;
  try {
    net.setOptions({
      layout: { hierarchical: { enabled: false }, improvedLayout: false },
      physics: { enabled: false },
    });
  } catch { /* ignore */ }
  const stored = _logIntelLayoutPositions || _liLoadLayoutFromStorage(_logIntelSelectedKey);
  if (stored) {
    _liApplyStoredLayout(net);
  } else {
    _liFreezeAllNodePositions(net);
    try { net.fit({ animation: false }); } catch { /* ignore */ }
  }
}

function _liBindGraphWheel(el, getNet) {
  if (!el || el._liWheelBound) return;
  el._liWheelBound = true;
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const net = typeof getNet === 'function' ? getNet() : null;
    if (!net) return;
    const scale = net.getScale();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    let newScale = scale * factor;
    newScale = Math.max(0.12, Math.min(2.8, newScale));
    const rect = el.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    const view = net.getViewPosition();
    const worldX = (offsetX - view.x) / scale;
    const worldY = (offsetY - view.y) / scale;
    net.moveTo({
      position: { x: offsetX - worldX * newScale, y: offsetY - worldY * newScale },
      scale: newScale,
      animation: false,
    });
  }, { passive: false });
}

function _liFreezeAllNodePositions(net) {
  if (!net) return;
  try {
    const ids = net.body.data.nodes.getIds();
    if (!ids.length) return;
    const positions = net.getPositions(ids);
    const updates = ids.map((id) => {
      const pos = positions[id];
      if (!pos) return null;
      return { id, x: pos.x, y: pos.y, fixed: { x: true, y: true } };
    }).filter(Boolean);
    if (updates.length) net.body.data.nodes.update(updates);
  } catch { /* ignore */ }
}

function _liBindGraphEvents(net) {
  net.on('selectNode', (params) => {
    const id = params.nodes && params.nodes[0];
    if (!id) return;
    _liSelectGraphNode(id);
  });
  net.on('deselectNode', () => {
    _liSelectGraphNode('');
  });
  net.on('click', (params) => {
    if (params.nodes && params.nodes.length) return;
    _liSelectGraphNode('');
    try { net.unselectAll(); } catch { /* ignore */ }
  });
  net.on('dragStart', (params) => {
    if (!params.nodes || !params.nodes.length) return;
    try {
      net.body.data.nodes.update(params.nodes.map((id) => ({ id, fixed: false })));
    } catch { /* ignore */ }
  });
  net.on('dragEnd', (params) => {
    if (!params.nodes || !params.nodes.length) return;
    try {
      const positions = net.getPositions(params.nodes);
      net.body.data.nodes.update(params.nodes.map((id) => {
        const pos = positions[id];
        if (!pos) return { id, fixed: { x: true, y: true } };
        return { id, x: pos.x, y: pos.y, fixed: { x: true, y: true } };
      }));
      const allPos = net.getPositions(net.body.data.nodes.getIds());
      _logIntelLayoutPositions = allPos;
      _liSaveLayoutToStorage(_logIntelSelectedKey, allPos);
    } catch { /* ignore */ }
  });
  let finalized = false;
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    _liFinalizeStaticGraph(net);
  };
  net.once('afterDrawing', finalize);
  setTimeout(finalize, 50);
}

function renderLogIntelGraph(corr) {
  const el = document.getElementById('log-intel-graph');
  if (!el) return;
  if (typeof vis === 'undefined') {
    el.innerHTML = `<div class="muted" style="padding:1rem">${esc(_liT('dash.log_intel_graph_unavailable', 'Graph viewer failed to load (vis-network). Refresh the page.'))}</div>`;
    return;
  }
  const nodes = (corr.nodes || []).map(_liNodeStyle);
  const edges = (corr.edges || []).map((e, i) => ({
    id: `e${i}`,
    from: e.from,
    to: e.to,
    value: e.weight,
    label: String(e.weight || ''),
    width: Math.min(7, 1.2 + Math.log10((e.weight || 1) + 1) * 1.8),
    title: e.title || `${e.weight || 0} transitions`,
    color: _liEdgeColor('neutral'),
  }));
  if (_logIntelGraph) {
    try {
      _logIntelLayoutPositions = _logIntelGraph.getPositions(_logIntelGraph.body.data.nodes.getIds());
    } catch { /* ignore */ }
    try { _logIntelGraph.destroy(); } catch { /* ignore */ }
    _logIntelGraph = null;
  }
  _logIntelSelectedNodeId = '';
  _liUpdateNodeInspector(null);
  if (!nodes.length) {
    el.innerHTML = `<div class="muted lintel-graph-empty">${esc(_liT('dash.log_intel_no_graph', 'Correlation graph needs more events.'))}</div>`;
    return;
  }
  el.innerHTML = '';
  _liBindGraphWheel(el, () => _logIntelGraph);
  const net = new vis.Network(
    el,
    { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) },
    _liGraphOptions(true),
  );
  _liBindGraphEvents(net);
  _logIntelGraph = net;
}

function fitLogIntelGraph() {
  if (!_logIntelGraph) return;
  try { _logIntelGraph.fit({ animation: false }); } catch { /* ignore */ }
}

function resetLogIntelGraphLayout() {
  if (!_logIntelCorrData) return;
  _logIntelSelectedNodeId = '';
  _liMarkSelectedCluster('');
  _liUpdateNodeInspector(null);
  renderLogIntelGraph(_logIntelCorrData);
  _liUpdateSimplifyBtn();
}

async function trainLogIntelContainer(opts) {
  opts = opts || {};
  const key = _logIntelSelectedKey;
  if (!key) return;
  const btn = document.querySelector('[data-dash-action="trainLogIntelContainer"]');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(apiUrl(`api/log-intel/containers/${encodeURIComponent(key)}/train`), {
      method: 'POST',
    }).catch(() => null);
    if (!res || !res.ok) {
      if (!opts.silent && typeof showToast === 'function') {
        showToast(_liT('dash.log_intel_train_err', 'Could not load container logs'), 'err');
      }
      return;
    }
    if (!opts.silent) await loadLogIntelDetail(key, { skipTrain: true });
    else return res.json();
  } finally {
    if (btn) btn.disabled = false;
  }
}
