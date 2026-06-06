// Lazy-load heavy CDN libraries only when a tab needs them (Chart.js, vis-network).
const _lazyLibPromises = {};

function _loadScriptOnce(key, src, globalCheck) {
  if (_lazyLibPromises[key]) return _lazyLibPromises[key];
  if (globalCheck()) return Promise.resolve();
  _lazyLibPromises[key] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
  return _lazyLibPromises[key];
}

function ensureChartJs() {
  return _loadScriptOnce(
    'chart',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js',
    () => typeof Chart !== 'undefined',
  );
}

function ensureVisNetwork() {
  return _loadScriptOnce(
    'vis',
    'https://cdn.jsdelivr.net/npm/vis-network@9.1.9/standalone/umd/vis-network.min.js',
    () => typeof vis !== 'undefined',
  );
}
