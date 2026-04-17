// fetchKeyed / FETCH_ABORTED / abortFetchKey — split from dashboard.js.
// Load after dashboard.helpers.js, before dashboard.js (trends + dashboard panels depend on these).

// ─────────────────────────────────────────────────────────────────────────────
// Fetch helpers (AbortController + simple dedupe)
// ─────────────────────────────────────────────────────────────────────────────
const _fetchCtl = new Map(); // key -> AbortController
const _fetchInFlight = new Map(); // key -> Promise<Response|null>
/** Resolved when fetch was superseded by a newer fetchKeyed for the same key — do not clear UI. */
const FETCH_ABORTED = Symbol('fetch_aborted');
function fetchKeyed(key, url, opts) {
  // Abort any previous request for this key.
  const prev = _fetchCtl.get(key);
  if (prev) { try { prev.abort(); } catch {} }

  const ctl = new AbortController();
  _fetchCtl.set(key, ctl);

  const p = fetch(url, { ...(opts || {}), signal: ctl.signal })
    .then(res => res)
    .catch((e) => {
      if (e && (e.name === 'AbortError' || String(e).includes('AbortError'))) return FETCH_ABORTED;
      return null;
    })
    .finally(() => {
      // Only clear if this is still the current controller.
      if (_fetchCtl.get(key) === ctl) _fetchCtl.delete(key);
      if (_fetchInFlight.get(key) === p) _fetchInFlight.delete(key);
    });

  _fetchInFlight.set(key, p);
  return p;
}

function abortFetchKey(key) {
  const ctl = _fetchCtl.get(key);
  if (ctl) { try { ctl.abort(); } catch {} }
  _fetchCtl.delete(key);
  _fetchInFlight.delete(key);
}
