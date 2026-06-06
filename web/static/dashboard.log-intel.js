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

const _LI_COLORS = {
  root: { fill: '#14532d', border: '#22c55e', edge: '#22c55e' },
  hub: { fill: '#78350f', border: '#f59e0b', edge: '#f59e0b' },
  leaf: { fill: '#312e81', border: '#6366f1', edge: '#6366f1' },
  error: { fill: '#7f1d1d', border: '#ef4444', edge: '#ef4444' },
  warn: { fill: '#713f12', border: '#eab308', edge: '#eab308' },
  normal: { fill: '#1e3a8a', border: '#3b82f6', edge: '#64748b' },
  out: { fill: '#065f46', border: '#34d399', edge: '#34d399' },
  in: { fill: '#78350f', border: '#fbbf24', edge: '#fbbf24' },
};

function _liNodeColors(n) {
  const level = String(n.level || 'info');
  const role = String(n.role || 'normal');
  if (level === 'error') return _LI_COLORS.error;
  if (level === 'warn') return _LI_COLORS.warn;
  if (role === 'root') return _LI_COLORS.root;
  if (role === 'hub') return _LI_COLORS.hub;
  if (role === 'leaf') return _LI_COLORS.leaf;
  return _LI_COLORS.normal;
}

function _liEdgeColor(kind) {
  const c = _LI_COLORS[kind] || _LI_COLORS.normal;
  const edge = c.edge || c.border;
  if (kind === 'dim') return { color: 'rgba(100,116,139,.18)', highlight: '#64748b', hover: '#64748b' };
  if (kind === 'neutral') return { color: `${edge}66`, highlight: edge, hover: edge };
  return { color: edge, highlight: edge, hover: edge };
}

function _liLegendModes() {
  return ['all', 'root', 'hub', 'leaf', 'error', 'warn', 'out', 'in'];
}

function _liNodeMatchesLegend(n, mode) {
  if (!mode || mode === 'all') return true;
  const role = String(n.role || 'normal');
  const level = String(n.level || 'info');
  if (mode === 'root') return role === 'root';
  if (mode === 'hub') return role === 'hub';
  if (mode === 'leaf') return role === 'leaf';
  if (mode === 'error') return level === 'error';
  if (mode === 'warn') return level === 'warn';
  if (mode === 'out') return Number(n.out_degree || 0) > 0;
  if (mode === 'in') return Number(n.in_degree || 0) > 0;
  return true;
}

function _liDisplayTemplate(text, maxLen) {
  maxLen = maxLen || 0;
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^\[[^\]]*(?:\d{4}|\d{2}:\d{2}:\d{2})[^\]]*\]\s*/, '');
  s = s.replace(/^\[(?:<N>|[\s<N>:,.\-+/])+\]\s*/, '');
  s = s.replace(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\dZ+\-: ]*\s*/, '');
  s = s.replace(/^(INFO|WARN|WARNING|ERROR|DEBUG|TRACE|FATAL|CRITICAL)\s+/i, '');
  if (maxLen > 0 && s.length > maxLen) return `${s.slice(0, maxLen - 1)}…`;
  return s;
}

function _liCompactLabel(n, maxLen) {
  return _liDisplayTemplate(String(n.label || n.id || ''), maxLen || 26);
}

function _liNodeIsLabeled(n) {
  return n.level === 'error' || n.level === 'warn' || n.role === 'root';
}

function _liNodeStyle(n, opts) {
  opts = opts || {};
  const expanded = !!opts.expanded;
  const count = Number(n.count || 0);
  const inDeg = Number(n.in_degree || 0);
  const outDeg = Number(n.out_degree || 0);
  const short = String(n.label || n.id || '').replace(/\s+/g, ' ').trim();
  const display = _liDisplayTemplate(short);
  const compact = _liCompactLabel(n, expanded ? 36 : 24);
  const { fill, border } = _liNodeColors(n);

  const showBox = expanded || _liNodeIsLabeled(n);
  const dotSize = Math.min(22, 8 + Math.log10(count + 1) * 4.5);
  const label = showBox && compact ? (count > 0 ? `×${count} ${compact}` : compact) : '';

  return {
    id: n.id,
    label,
    title: [
      _liRoleLabel(n.role),
      display || short,
      `${_liT('dash.log_intel_node_links', 'Links')}: ↙${inDeg} ${_liT('dash.log_intel_node_in', 'incoming')} · ↗${outDeg} ${_liT('dash.log_intel_node_out', 'outgoing')}`,
      `count: ${count}`,
    ].join('\n'),
    shape: showBox ? 'box' : 'dot',
    size: showBox ? undefined : dotSize,
    margin: showBox ? 8 : 5,
    widthConstraint: showBox ? { minimum: 72, maximum: expanded ? 240 : 168 } : undefined,
    color: {
      background: fill,
      border,
      highlight: { background: fill, border: '#f8fafc' },
      hover: { background: fill, border: '#e2e8f0' },
    },
    font: {
      color: '#e2e8f0',
      size: showBox ? 10 : 0,
      face: 'ui-sans-serif, system-ui, sans-serif',
      multi: false,
      vadjust: 0,
    },
    borderWidth: showBox ? 2 : 1.5,
    borderRadius: showBox ? 6 : undefined,
    shadow: showBox ? {
      enabled: true,
      color: 'rgba(0,0,0,0.22)',
      size: 6,
      x: 0,
      y: 1,
    } : false,
  };
}

let _logIntelCorrView = 'graph';
let _logIntelSelectedNodeId = '';
let _logIntelCorrRaw = null;
let _logIntelGraphSimplified = false;
let _logIntelLegendFilter = 'all';
let _logIntelGraphSearch = '';
let _logIntelHoverNodeId = '';
let _logIntelWatch = false;
let _logIntelLiveTimer = null;
let _logIntelLiveSig = '';
let _logIntelLayoutPositions = null;
const _LI_LAYOUT_PREFIX = 'cimon-lintel-layout:v4:';

function _liHashJitter(id, amp) {
  let h = 0;
  const s = String(id || '');
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 1000) / 1000 - 0.5) * amp;
}

function initLogIntelBindings() {
  const watch = document.getElementById('log-intel-watch');
  if (watch && !watch._liBound) {
    watch._liBound = true;
    watch.addEventListener('change', () => toggleLogIntelWatch());
  }
  const search = document.getElementById('log-intel-graph-search');
  if (search && !search._liBound) {
    search._liBound = true;
    let searchTimer = null;
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        _logIntelGraphSearch = search.value || '';
        _liApplyGraphFocus();
      }, 220);
    });
    search.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      _logIntelGraphSearch = search.value || '';
      _liJumpToGraphSearchMatch();
    });
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
  _logIntelLegendFilter = 'all';
  _logIntelGraphSearch = '';
  _logIntelHoverNodeId = '';
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
  _logIntelLegendFilter = 'all';
  _logIntelGraphSearch = '';
  _logIntelHoverNodeId = '';
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
  _liApplyGraphFocus();
  if (opts.flashCluster !== false) _liMarkSelectedCluster(_logIntelSelectedNodeId);
  const nodes = _liNodeMap(_logIntelCorrData || {});
  _liUpdateNodeInspector(nodes.get(_logIntelSelectedNodeId) || null);
  if (_logIntelSelectedNodeId) _liFitGraphNeighborhood(_logIntelSelectedNodeId);
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
  const short = _liDisplayTemplate(String(node.label || node.id || ''));
  el.hidden = false;
  el.innerHTML = `
    <div class="lintel-inspector-main">
      <span class="lintel-inspector-role ${_liRoleClass(node.role)}">${esc(_liRoleLabel(node.role))}</span>
      ${node.level === 'error' ? `<span class="lintel-inspector-level lintel-inspector-error">${esc(_liT('dash.log_intel_legend_error', 'Error'))}</span>` : ''}
      ${node.level === 'warn' ? `<span class="lintel-inspector-level lintel-inspector-warn">${esc(_liT('dash.log_intel_legend_warn', 'Warn'))}</span>` : ''}
      <span class="lintel-inspector-label" title="${esc(String(node.label || node.id || ''))}">${esc(short)}</span>
    </div>
    <div class="lintel-inspector-stats">
      <span class="lintel-inspector-stat lintel-inspector-in" title="${esc(_liT('dash.log_intel_edge_in', 'Incoming'))}">↙ ${esc(String(inDeg))}</span>
      <span class="lintel-inspector-stat lintel-inspector-out" title="${esc(_liT('dash.log_intel_edge_out', 'Outgoing'))}">↗ ${esc(String(outDeg))}</span>
      <span class="lintel-inspector-stat">×${esc(String(node.count || 0))}</span>
    </div>`;
}

function _liNodeBorderWidth(n, selected) {
  if (selected) return 3;
  return _liNodeIsLabeled(n) ? 2 : 1.5;
}

function _liEdgeKindForDisplay(e, focusId, linked, nodeById) {
  const from = String(e.from);
  const to = String(e.to);
  if (focusId) {
    if (from === focusId) return 'out';
    if (to === focusId) return 'in';
    return 'dim';
  }
  const mode = _logIntelLegendFilter;
  if (mode === 'out') return 'out';
  if (mode === 'in') return 'in';
  if (mode && mode !== 'all') {
    const fromN = nodeById.get(from);
    const toN = nodeById.get(to);
    const fromMatch = fromN && _liNodeMatchesLegend(fromN, mode);
    const toMatch = toN && _liNodeMatchesLegend(toN, mode);
    if (fromMatch && toMatch) return mode;
    if (fromMatch) return 'out';
    if (toMatch) return 'in';
    return 'dim';
  }
  return 'neutral';
}

function _liApplyGraphFocus() {
  if (!_logIntelGraph || !_logIntelCorrData) return;
  const focusId = _logIntelSelectedNodeId || _logIntelHoverNodeId || '';
  const q = String(_logIntelGraphSearch || '').trim().toLowerCase();
  const legendMode = _logIntelLegendFilter;
  const edges = Array.isArray(_logIntelCorrData.edges) ? _logIntelCorrData.edges : [];
  const nodes = Array.isArray(_logIntelCorrData.nodes) ? _logIntelCorrData.nodes : [];
  const nodeById = _liNodeMap(_logIntelCorrData);
  const linked = new Set();
  if (focusId) linked.add(String(focusId));
  const edgeUpdates = edges.map((e, i) => {
    const from = String(e.from);
    const to = String(e.to);
    if (focusId) {
      if (from === focusId) linked.add(to);
      else if (to === focusId) linked.add(from);
    }
    const kind = _liEdgeKindForDisplay(e, focusId, linked, nodeById);
    const w = Number(e.weight || 0);
    return {
      id: `e${i}`,
      color: _liEdgeColor(kind),
      width: kind === 'dim' ? 0.8 : Math.min(4, 0.8 + Math.log10(w + 1) * 1.2),
    };
  });
  const nodeUpdates = nodes.map((n) => {
    const id = String(n.id);
    let opacity = 1;
    if (focusId) {
      opacity = linked.has(id) ? 1 : 0.22;
    } else if (q) {
      const hay = String(n.label || n.id || '').toLowerCase();
      opacity = hay.includes(q) ? 1 : 0.14;
    } else if (legendMode && legendMode !== 'all') {
      opacity = _liNodeMatchesLegend(n, legendMode) ? 1 : 0.2;
    }
    const expanded = focusId && id === focusId;
    const forceBox = expanded || (legendMode && legendMode !== 'all' && _liNodeMatchesLegend(n, legendMode));
    const styled = _liNodeStyle(n, { expanded: expanded || forceBox });
    return {
      ...styled,
      opacity,
      borderWidth: _liNodeBorderWidth(n, id === focusId),
    };
  });
  try {
    _logIntelGraph.body.data.edges.update(edgeUpdates);
    _logIntelGraph.body.data.nodes.update(nodeUpdates);
  } catch { /* ignore */ }
}

function _liFitGraphNeighborhood(nodeId) {
  if (!_logIntelGraph || !nodeId) return;
  const edges = Array.isArray(_logIntelCorrData?.edges) ? _logIntelCorrData.edges : [];
  const related = new Set([String(nodeId)]);
  edges.forEach((e) => {
    const from = String(e.from);
    const to = String(e.to);
    if (from === nodeId) related.add(to);
    if (to === nodeId) related.add(from);
  });
  try {
    _logIntelGraph.fit({
      nodes: [...related],
      animation: { duration: 300, easingFunction: 'easeInOutQuad' },
    });
  } catch { /* ignore */ }
}

function _liJumpToGraphSearchMatch() {
  const q = String(_logIntelGraphSearch || '').trim().toLowerCase();
  if (!q || !_logIntelCorrData) return;
  const match = (_logIntelCorrData.nodes || []).find((n) => (
    String(n.label || n.id || '').toLowerCase().includes(q)
  ));
  if (!match) {
    if (typeof showToast === 'function') {
      showToast(_liT('dash.log_intel_graph_search_miss', 'No matching template on graph'), 'warn');
    }
    return;
  }
  if (_logIntelCorrView !== 'graph') setLogIntelCorrView('graph');
  _liSelectGraphNode(String(match.id));
  try { _logIntelGraph.selectNodes([match.id]); } catch { /* ignore */ }
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

  _logIntelCorrRaw = data.correlation || { nodes: [], edges: [] };
  _logIntelGraphSimplified = _liShouldAutoSimplify(_logIntelCorrRaw);
  _logIntelLegendFilter = 'all';
  _logIntelGraphSearch = '';
  _logIntelHoverNodeId = '';
  const searchEl = document.getElementById('log-intel-graph-search');
  if (searchEl) searchEl.value = '';
  _logIntelCorrData = _liPrepareGraphCorr(_logIntelCorrRaw, _logIntelGraphSimplified);
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
        const tplShown = _liDisplayTemplate(c.template || '');
        return `
        <div class="lintel-row" data-lintel-cluster-id="${esc(String(c.id || ''))}" title="${esc(c.template || '')}">
          <div class="lintel-row-top">
            <span class="badge ${c.level === 'error' ? 'fail' : c.level === 'warn' ? 'warn' : 'ok'}">${esc(c.level)}</span>
            <span class="lintel-role-pill ${_liRoleClass(role)}">${esc(_liRoleLabel(role))}</span>
            <span class="mono lintel-row-count">×${esc(String(c.count))}</span>
            <span class="lintel-row-deg" title="${esc(_liT('dash.log_intel_node_links', 'Links'))}">↙${esc(String(inDeg))} ↗${esc(String(outDeg))}</span>
          </div>
          <div class="lintel-tpl">${esc(tplShown)}</div>
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
  _liUpdateGraphStats(_logIntelCorrData);
  _liUpdateSimplifyBtn();
  _liUpdateLegendFilterUi();
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
  const short = _liDisplayTemplate(String(n.label || n.id || ''));
  return short.length > 56 ? `${short.slice(0, 54)}…` : short;
}

function _liNodeMap(corr) {
  const map = new Map();
  (corr.nodes || []).forEach((n) => {
    if (n && n.id) map.set(String(n.id), n);
  });
  return map;
}

/** Keep only nodes that participate in at least one transition. */
function _liLinkedOnlyCorr(corr) {
  const nodes = Array.isArray(corr?.nodes) ? corr.nodes : [];
  const edges = Array.isArray(corr?.edges) ? corr.edges : [];
  if (!edges.length) return { nodes: [], edges: [] };
  const linked = new Set();
  edges.forEach((e) => {
    linked.add(String(e.from));
    linked.add(String(e.to));
  });
  return {
    nodes: nodes.filter((n) => n && n.id && linked.has(String(n.id))),
    edges,
  };
}

function _liShouldAutoSimplify(corr) {
  const nodes = Array.isArray(corr?.nodes) ? corr.nodes.length : 0;
  const edges = Array.isArray(corr?.edges) ? corr.edges.length : 0;
  return nodes > 8 || edges > 18;
}

function _liCapGraph(corr, maxNodes, maxEdges) {
  const nodes = Array.isArray(corr?.nodes) ? [...corr.nodes] : [];
  const edges = Array.isArray(corr?.edges) ? [...corr.edges] : [];
  if (nodes.length <= maxNodes && edges.length <= maxEdges) return { nodes, edges };
  const ranked = [...nodes].sort((a, b) => {
    const score = (n) => {
      let s = Number(n.count || 0);
      if (n.level === 'error') s += 10000;
      if (n.level === 'warn') s += 5000;
      if (n.role === 'root') s += 2000;
      s += (Number(n.in_degree || 0) + Number(n.out_degree || 0)) * 100;
      return s;
    };
    return score(b) - score(a);
  });
  const keep = new Set(ranked.slice(0, maxNodes).map((n) => String(n.id)));
  const keptEdges = edges
    .filter((e) => keep.has(String(e.from)) && keep.has(String(e.to)))
    .sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0))
    .slice(0, maxEdges);
  keptEdges.forEach((e) => {
    keep.add(String(e.from));
    keep.add(String(e.to));
  });
  return {
    nodes: nodes.filter((n) => keep.has(String(n.id))),
    edges: keptEdges,
  };
}

function _liFilterCorrByLegend(corr, mode) {
  if (!mode || mode === 'all') return corr;
  const nodes = Array.isArray(corr?.nodes) ? corr.nodes : [];
  const edges = Array.isArray(corr?.edges) ? corr.edges : [];

  if (mode === 'out') {
    const keep = new Set();
    const keptEdges = edges.filter((e) => {
      const fromN = nodes.find((n) => String(n.id) === String(e.from));
      if (!fromN || Number(fromN.out_degree || 0) < 1) return false;
      keep.add(String(e.from));
      keep.add(String(e.to));
      return true;
    });
    return {
      nodes: nodes.filter((n) => keep.has(String(n.id))),
      edges: keptEdges,
    };
  }
  if (mode === 'in') {
    const keep = new Set();
    const keptEdges = edges.filter((e) => {
      const toN = nodes.find((n) => String(n.id) === String(e.to));
      if (!toN || Number(toN.in_degree || 0) < 1) return false;
      keep.add(String(e.from));
      keep.add(String(e.to));
      return true;
    });
    return {
      nodes: nodes.filter((n) => keep.has(String(n.id))),
      edges: keptEdges,
    };
  }

  const seed = new Set();
  nodes.forEach((n) => {
    if (_liNodeMatchesLegend(n, mode)) seed.add(String(n.id));
  });
  if (!seed.size) return { nodes: [], edges: [] };

  const keep = new Set(seed);
  edges.forEach((e) => {
    const from = String(e.from);
    const to = String(e.to);
    if (seed.has(from) || seed.has(to)) {
      keep.add(from);
      keep.add(to);
    }
  });
  return {
    nodes: nodes.filter((n) => keep.has(String(n.id))),
    edges: edges.filter((e) => keep.has(String(e.from)) && keep.has(String(e.to))),
  };
}

function _liPrepareGraphCorr(corr, simplified) {
  let data = _liFilterCorrByLegend(corr, _logIntelLegendFilter);
  data = _liLinkedOnlyCorr(data);
  if (simplified) data = _liSimplifyCorrelation(data);
  else data = _liCapGraph(data, 28, 40);
  return data;
}

function _liRefreshGraphView() {
  if (!_logIntelCorrRaw) return;
  _logIntelCorrData = _liPrepareGraphCorr(_logIntelCorrRaw, _logIntelGraphSimplified);
  renderLogIntelCorrList(_logIntelCorrData);
  renderLogIntelGraph(_logIntelCorrData);
  _liUpdateGraphStats(_logIntelCorrData);
  _liUpdateSimplifyBtn();
  _liUpdateLegendFilterUi();
}

function _liUpdateGraphStats(corr) {
  const el = document.getElementById('log-intel-graph-stats');
  if (!el) return;
  const n = Array.isArray(corr?.nodes) ? corr.nodes.length : 0;
  const e = Array.isArray(corr?.edges) ? corr.edges.length : 0;
  const rawN = Array.isArray(_logIntelCorrRaw?.nodes) ? _logIntelCorrRaw.nodes.length : n;
  const rawE = Array.isArray(_logIntelCorrRaw?.edges) ? _logIntelCorrRaw.edges.length : e;
  let text = _liT('dash.log_intel_graph_stats', '{nodes} nodes · {edges} links')
    .replace('{nodes}', String(n))
    .replace('{edges}', String(e));
  if (rawN > n || rawE > e) {
    text += ` ${_liT('dash.log_intel_graph_capped', '(of {rawN}/{rawE})')
      .replace('{rawN}', String(rawN))
      .replace('{rawE}', String(rawE))}`;
  }
  el.textContent = text;
}

function _liUpdateLegendFilterUi() {
  document.querySelectorAll('[data-lintel-legend]').forEach((btn) => {
    const mode = btn.getAttribute('data-lintel-legend');
    btn.classList.toggle('active', mode === _logIntelLegendFilter);
    btn.setAttribute('aria-pressed', mode === _logIntelLegendFilter ? 'true' : 'false');
  });
}

function setLogIntelLegendFilter(mode) {
  if (!_liLegendModes().includes(mode)) mode = 'all';
  if (_logIntelLegendFilter === mode && mode !== 'all') {
    mode = 'all';
  } else if (_logIntelLegendFilter === mode) {
    return;
  }
  _logIntelLegendFilter = mode;
  _logIntelSelectedNodeId = '';
  _logIntelHoverNodeId = '';
  _liMarkSelectedCluster('');
  _liUpdateNodeInspector(null);
  _liRefreshGraphView();
  setLogIntelCorrView('graph');
}

function setLogIntelGraphFilter(mode) {
  setLogIntelLegendFilter(mode === 'error' || mode === 'warn' ? mode : 'all');
}

function _liSeedSpreadLayout(rawNodes) {
  const n = rawNodes.length;
  if (n < 2) return rawNodes;
  const cols = Math.max(3, Math.ceil(Math.sqrt(n * 1.35)));
  const rows = Math.ceil(n / cols);
  const spacingX = Math.max(130, 115 + n * 1.8);
  const spacingY = Math.max(95, 85 + n * 0.9);
  return rawNodes.map((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const id = node.id || i;
    return {
      ...node,
      x: (col - (cols - 1) / 2) * spacingX + _liHashJitter(id, 28),
      y: (row - (rows - 1) / 2) * spacingY + _liHashJitter(`${id}:y`, 22),
    };
  });
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
  }).slice(0, 28);

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
    if (role === 'root') return true;
    if (role === 'hub' && (level === 'error' || level === 'warn')) return true;
    if (count >= 5 || deg >= 3) return true;
    return false;
  });

  return { nodes: keptNodes.length ? keptNodes : nodes.slice(0, 18), edges: keptEdges.length ? keptEdges : edges.slice(0, 22) };
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
  _logIntelSelectedNodeId = '';
  _logIntelHoverNodeId = '';
  _liMarkSelectedCluster('');
  _liUpdateNodeInspector(null);
  _liRefreshGraphView();
  setLogIntelCorrView('graph');
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
    requestAnimationFrame(() => _liFitGraphComfortably(_logIntelGraph, false));
  }
}

function _liGraphOptions(usePhysics) {
  const nodeCount = _logIntelCorrData?.nodes?.length || 0;
  const edgeCount = _logIntelCorrData?.edges?.length || 0;
  const spread = Math.max(nodeCount, Math.ceil(Math.sqrt(edgeCount)));
  const opts = {
    physics: usePhysics ? {
      enabled: true,
      stabilization: {
        enabled: true,
        iterations: Math.min(600, 120 + spread * 10),
        updateInterval: 25,
        fit: false,
      },
      barnesHut: {
        gravitationalConstant: -22000 - spread * 120,
        centralGravity: 0.03,
        springLength: Math.max(240, 200 + spread * 10),
        springConstant: 0.032,
        damping: 0.22,
        avoidOverlap: 1.45,
      },
      maxVelocity: 28,
      minVelocity: 0.35,
    } : { enabled: false },
    interaction: {
      hover: true,
      tooltipDelay: 100,
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
      smooth: { enabled: false },
      color: _liEdgeColor('neutral'),
      arrows: { to: { enabled: true, scaleFactor: 0.35, type: 'arrow' } },
      font: {
        color: '#cbd5e1',
        size: 9,
        strokeWidth: 3,
        strokeColor: '#0b1220',
        align: 'middle',
        background: 'rgba(11,18,32,.72)',
      },
      selectionWidth: 1.5,
    },
    nodes: {
      chosen: {
        node(values) {
          values.borderWidth = 3.5;
          values.shadow = true;
        },
      },
    },
    layout: { hierarchical: { enabled: false }, improvedLayout: false },
    configure: { enabled: false },
  };
  return opts;
}

function _liFitGraphComfortably(net, animate) {
  if (!net) return;
  try {
    net.fit({
      animation: animate ? { duration: 380, easingFunction: 'easeInOutQuad' } : false,
    });
  } catch { /* ignore */ }
  try {
    const scale = net.getScale();
    if (scale > 1.05) {
      net.moveTo({
        scale: scale * 0.82,
        animation: animate ? { duration: 260, easingFunction: 'easeInOutQuad' } : false,
      });
    }
  } catch { /* ignore */ }
}

function _liFinalizeStaticGraph(net) {
  if (!net) return;
  const el = document.getElementById('log-intel-graph');
  try {
    net.setOptions({ physics: { enabled: false } });
  } catch { /* ignore */ }
  const stored = _logIntelLayoutPositions || _liLoadLayoutFromStorage(_logIntelSelectedKey);
  if (stored) {
    _liApplyStoredLayout(net);
    _liFitGraphComfortably(net, false);
  } else {
    _liFreezeAllNodePositions(net);
    _liFitGraphComfortably(net, true);
  }
  if (el) {
    requestAnimationFrame(() => el.classList.remove('lintel-graph-busy'));
  }
  _liApplyGraphFocus();
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

function _liBindGraphEvents(net, usePhysics) {
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
    _logIntelHoverNodeId = '';
    _liSelectGraphNode('');
    try { net.unselectAll(); } catch { /* ignore */ }
  });
  net.on('hoverNode', (params) => {
    if (_logIntelSelectedNodeId) return;
    _logIntelHoverNodeId = params.node ? String(params.node) : '';
    _liApplyGraphFocus();
  });
  net.on('blurNode', () => {
    if (_logIntelSelectedNodeId) return;
    _logIntelHoverNodeId = '';
    _liApplyGraphFocus();
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
  if (usePhysics) {
    net.on('stabilizationIterationsDone', finalize);
    net.on('stabilized', finalize);
    setTimeout(finalize, 8000);
  } else {
    finalize();
  }
}

function renderLogIntelGraph(corr) {
  const el = document.getElementById('log-intel-graph');
  if (!el) return;
  if (typeof vis === 'undefined') {
    el.innerHTML = `<div class="muted" style="padding:1rem">${esc(_liT('dash.log_intel_graph_unavailable', 'Graph viewer failed to load (vis-network). Refresh the page.'))}</div>`;
    return;
  }
  const rawEdges = Array.isArray(corr.edges) ? corr.edges : [];
  const rawNodes = Array.isArray(corr.nodes) ? corr.nodes : [];
  const hasStoredLayout = !!(_logIntelLayoutPositions || _liLoadLayoutFromStorage(_logIntelSelectedKey));
  const styled = rawNodes.map((n) => _liNodeStyle(n));
  const nodes = hasStoredLayout ? styled : _liSeedSpreadLayout(styled);
  const nodeById = _liNodeMap(corr);
  const edges = rawEdges.map((e, i) => {
    const w = Number(e.weight || 0);
    const kind = _liEdgeKindForDisplay(e, '', new Set(), nodeById);
    return {
      id: `e${i}`,
      from: e.from,
      to: e.to,
      value: w,
      label: '',
      width: Math.min(2.5, 0.5 + Math.log10(w + 1) * 0.75),
      title: e.title || `${w} transitions`,
      color: _liEdgeColor(kind),
    };
  });
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
    const msg = _logIntelLegendFilter !== 'all'
      ? _liT('dash.log_intel_graph_filter_empty', 'No nodes match this filter')
      : _liT('dash.log_intel_no_graph', 'Correlation graph needs more events.');
    el.innerHTML = `<div class="muted lintel-graph-empty">${esc(msg)}</div>`;
    return;
  }
  el.innerHTML = '';
  el.setAttribute('data-layout-msg', _liT('dash.log_intel_graph_layout', 'Arranging graph…'));
  el.classList.add('lintel-graph-busy');
  _liBindGraphWheel(el, () => _logIntelGraph);
  const usePhysics = !hasStoredLayout;
  const net = new vis.Network(
    el,
    { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) },
    _liGraphOptions(usePhysics),
  );
  _liBindGraphEvents(net, usePhysics);
  _logIntelGraph = net;
  _liUpdateGraphStats(corr);
  if (!usePhysics) _liApplyGraphFocus();
}

function fitLogIntelGraph() {
  _liFitGraphComfortably(_logIntelGraph, true);
}

function resetLogIntelGraphLayout() {
  if (!_logIntelCorrData) return;
  _logIntelSelectedNodeId = '';
  _logIntelLayoutPositions = null;
  if (_logIntelSelectedKey) {
    try { localStorage.removeItem(_liLayoutStorageKey(_logIntelSelectedKey)); } catch { /* ignore */ }
  }
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
