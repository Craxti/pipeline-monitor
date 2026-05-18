// Trends filter state: single source of truth for source/instance scope.
(function () {
  const LS = {
    source: 'cimon-trends-source',
    instAll: 'cimon-trends-inst-all',
    instBuilds: 'cimon-trends-inst-builds',
    instTests: 'cimon-trends-inst-tests',
    instTop: 'cimon-trends-inst-top',
  };

  const state = {
    source: '',
    instanceAll: '',
    instanceBuilds: '',
    instanceTests: '',
    instanceTop: '',
  };

  const norm = (v) => String(v || '').trim();
  const normSrc = (v) => norm(v).toLowerCase();
  const srcFromInst = (v) => {
    const s = norm(v);
    if (!s.includes('|')) return '';
    return s.split('|', 1)[0].trim().toLowerCase();
  };

  function load() {
    try { state.source = normSrc(localStorage.getItem(LS.source)); } catch { /* ignore */ }
    try { state.instanceAll = norm(localStorage.getItem(LS.instAll)); } catch { /* ignore */ }
    try { state.instanceBuilds = norm(localStorage.getItem(LS.instBuilds)); } catch { /* ignore */ }
    try { state.instanceTests = norm(localStorage.getItem(LS.instTests)); } catch { /* ignore */ }
    try { state.instanceTop = norm(localStorage.getItem(LS.instTop)); } catch { /* ignore */ }
    return { ...state };
  }

  function save() {
    try { localStorage.setItem(LS.source, state.source || ''); } catch { /* ignore */ }
    try { localStorage.setItem(LS.instAll, state.instanceAll || ''); } catch { /* ignore */ }
    try { localStorage.setItem(LS.instBuilds, state.instanceBuilds || ''); } catch { /* ignore */ }
    try { localStorage.setItem(LS.instTests, state.instanceTests || ''); } catch { /* ignore */ }
    try { localStorage.setItem(LS.instTop, state.instanceTop || ''); } catch { /* ignore */ }
  }

  function setSource(v) {
    state.source = normSrc(v);
    save();
  }

  function setInstanceAll(v) {
    state.instanceAll = norm(v);
    if (state.instanceAll) {
      state.instanceBuilds = state.instanceAll;
      state.instanceTests = state.instanceAll;
      state.instanceTop = state.instanceAll;
      state.source = srcFromInst(state.instanceAll) || state.source;
    }
    save();
  }

  function setInstanceLocal(key, v) {
    const val = norm(v);
    if (key === 'builds') state.instanceBuilds = val;
    if (key === 'tests') state.instanceTests = val;
    if (key === 'top') state.instanceTop = val;
    if (!state.instanceAll) state.source = srcFromInst(val) || state.source;
    save();
  }

  function effectiveScope() {
    const inst = state.instanceAll || state.instanceTop || state.instanceBuilds || state.instanceTests || '';
    const src = state.source || srcFromInst(inst);
    return { source: normSrc(src), instance: norm(inst) };
  }

  function reset() {
    state.source = '';
    state.instanceAll = '';
    state.instanceBuilds = '';
    state.instanceTests = '';
    state.instanceTop = '';
    save();
    return { ...state };
  }

  window.TrendsScope = {
    load,
    save,
    setSource,
    setInstanceAll,
    setInstanceLocal,
    effectiveScope,
    reset,
  };
})();
