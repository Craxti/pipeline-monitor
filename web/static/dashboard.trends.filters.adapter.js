// Adapter for Trends filters UI/localStorage operations.
(function () {
  const KEYS = [
    'cimon-trends-inst-all',
    'cimon-trends-inst-builds',
    'cimon-trends-inst-tests',
    'cimon-trends-inst-top',
    'cimon-trends-rfrom',
    'cimon-trends-rto',
    'cimon-trends-source',
    'cimon-trends-top-test-source',
    'cimon-trends-smooth',
    'cimon-trends-topn',
    'cimon-trends-scope-global',
  ];

  const IDS = {
    source: 'trends-source',
    instAll: 'trends-instance-all',
    instBuilds: 'trends-inst-builds',
    instTests: 'trends-inst-tests',
    instTop: 'trends-inst-top',
    topSource: 'trends-top-test-source',
    smooth: 'trends-smooth',
    topN: 'trends-topn',
    rangeFrom: 'trends-d-from',
    rangeTo: 'trends-d-to',
    scopeGlobal: 'trends-scope-global',
  };

  function _setVal(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value;
  }

  function clearStorage() {
    KEYS.forEach((k) => {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    });
  }

  function clearUI() {
    _setVal(IDS.source, '');
    _setVal(IDS.instAll, '');
    _setVal(IDS.instBuilds, '');
    _setVal(IDS.instTests, '');
    _setVal(IDS.instTop, '');
    _setVal(IDS.topSource, '');
    _setVal(IDS.smooth, 'none');
    _setVal(IDS.topN, '10');
    _setVal(IDS.rangeFrom, '');
    _setVal(IDS.rangeTo, '');
    const cb = document.getElementById(IDS.scopeGlobal);
    if (cb) cb.checked = false;
  }

  function clearPeriodButtons() {
    document.querySelectorAll('.trend-period-btn').forEach((b) => b.classList.remove('active'));
  }

  function loadState() {
    const v = (k, d = '') => {
      try { return localStorage.getItem(k) ?? d; } catch { return d; }
    };
    return {
      smooth: v('cimon-trends-smooth', 'none'),
      topn: v('cimon-trends-topn', '10'),
      rfrom: v('cimon-trends-rfrom', ''),
      rto: v('cimon-trends-rto', ''),
      scopeGlobal: v('cimon-trends-scope-global', '0') === '1',
    };
  }

  function persistState(partial) {
    const m = partial || {};
    const put = (k, v) => {
      try { localStorage.setItem(k, String(v)); } catch { /* ignore */ }
    };
    if (Object.prototype.hasOwnProperty.call(m, 'smooth')) put('cimon-trends-smooth', m.smooth);
    if (Object.prototype.hasOwnProperty.call(m, 'topn')) put('cimon-trends-topn', m.topn);
    if (Object.prototype.hasOwnProperty.call(m, 'rfrom')) put('cimon-trends-rfrom', m.rfrom);
    if (Object.prototype.hasOwnProperty.call(m, 'rto')) put('cimon-trends-rto', m.rto);
    if (Object.prototype.hasOwnProperty.call(m, 'scopeGlobal')) put('cimon-trends-scope-global', m.scopeGlobal ? '1' : '0');
  }

  function applyScopeToGlobalFilters(source, instance) {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    };
    set('f-source', source || '');
    set('f-instance', instance || '');
    if (typeof window._persistFiltersFromForm === 'function') {
      try { window._persistFiltersFromForm(); } catch { /* ignore */ }
    }
  }

  window.TrendsFiltersAdapter = {
    clearStorage,
    clearUI,
    clearPeriodButtons,
    loadState,
    persistState,
    applyScopeToGlobalFilters,
  };
})();
