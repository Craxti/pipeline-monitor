# How Filters Work End-to-End

This document explains how dashboard filters move through URL, UI state, API calls, and rendered data.

## 1) URL and local state

Frontend source of truth is in `web/static/dashboard.filters.js`.

- `_FILTER_PARAMS` declares URL keys and input bindings.
- `_readURLFilters()` applies query params to UI.
- `_maybeRestoreFiltersFromLS()` restores from `localStorage` only when URL does not override.
- `_writeURLFilters()` writes active filters back into `location.search`.

### Contract keys

- builds: `source`, `instance`, `status`, `job`, `hours`
- tests: `tstatus`, `tname`, `tsuite`
- failures: `fname`, `fsuite`
- services: `svstatus`
- common: `tab`

## 2) Reset behavior (important)

Clear actions must update both URL and `localStorage` to avoid filters returning after refresh.

- `clearBuildFilters()` -> `_persistFiltersFromForm()`
- `clearTestFilters()` -> `_persistFiltersFromForm()`
- `clearFailureFilters()` -> `_persistFiltersFromForm()`
- `clearSvcFilters()` -> `_persistFiltersFromForm()`

## 3) API filter application

Backend endpoints accept filter query params and apply filtering in service modules.

Examples:

- `/api/builds` (source, instance, status, job, hours)
- `/api/tests` (status, source, suite, name, hours)
- `/api/services` (status)
- `/api/trends/history-summary` (days, source, instance)

## 4) Trends and KPI alignment

Trends charts and KPI cards must use the same effective filter scope.

- active source: `_activeTrendsSource()`
- active instance: `_activeTrendsInstance()`
- KPI API call: `loadTrendsHistorySummary(days)` -> `/api/trends/history-summary`

Single source of truth for Trends scope is centralized in:

- `web/static/dashboard.trends.scope.js`

and consumed in:

- `web/static/dashboard.trends.js`

Instance/source synchronization rules:

- selecting an instance infers source (`jenkins|...`, `gitlab|...`)
- selecting incompatible source clears global instance

## 5) Test coverage for filter contracts

- API and model-side tests: `tests/test_trends_history_summary.py`
- frontend filter contracts: `tests/test_filters_frontend_contracts.py`

These tests are part of pre-merge smoke and nightly regression workflows.
