// Dashboard script chain — order in index.html matters (defer, same order as below).
// helpers → fetch → panel-state → build-log-cells → builds → failures → tests → services
// → collect-panel → status-map → diff-stages → timeline → flaky → uptime-sparklines
// → load-summary → collect-bar → (this file) → trends → actions → filters → sources
// → theme-export → chat → live → init
//
// This file is a shim: loadSummary lives in dashboard.load-summary.js; collect UI in dashboard.collect-bar.js.
//
// Panel state / _state / observers: dashboard.panel-state.js
// Build log cells: dashboard.build-log-cells.js
// BUILDS + top failures: dashboard.builds.js, dashboard.failures.js
// Tests + services: dashboard.tests.js, dashboard.services.js
// Collect log stream + parse note: dashboard.collect-panel.js
// Status map: dashboard.status-map.js
// Log diff + stages: dashboard.diff-stages.js
// Timeline: dashboard.timeline.js
// Flaky + correlation: dashboard.flaky.js
// Uptime + sparklines: dashboard.uptime-sparklines.js
// Snapshot reload: dashboard.load-summary.js
// Collect bar + pollCollect: dashboard.collect-bar.js
// LIVE/SSE: dashboard.live.js (before dashboard.init.js)
// Filters: dashboard.filters.js | Sources: dashboard.sources.js | Theme/CSV: dashboard.theme-export.js | Chat: dashboard.chat.js
