# Runbook: Typical Incidents

## Scope

Operational runbook for common CI/CD Monitor incidents in web mode.

## Incident 1: Dashboard shows stale data

Symptoms:
- stale badge/warning is visible
- snapshot age keeps growing

Actions:
1. Open `/api/collect/status` and verify `is_collecting`.
2. Trigger manual collect from UI.
3. Inspect Logs tab for retries/timeouts.
4. Check `/health` and `/ready` endpoints.

Escalate if:
- collect repeatedly fails for >15 minutes.

## Incident 2: Filters persist after reset

Symptoms:
- user clicks reset, refreshes page, old filters return.

Actions:
1. Verify URL query string was cleared.
2. Verify corresponding localStorage keys `cimon-f-*`.
3. Validate clear handlers call `_persistFiltersFromForm()`.
4. Re-run `tests/test_filters_frontend_contracts.py`.

## Incident 3: Trends KPI differs from charts

Symptoms:
- Trends chart filtered by instance, KPI still shows global values.

Actions:
1. Confirm selected source/instance in Trends toolbar.
2. Check request to `/api/trends/history-summary` includes `source` and `instance`.
3. Confirm history rows include per-instance slices.
4. Run `tests/test_trends_history_summary.py`.

## Incident 4: Nightly regression alert opened

Symptoms:
- GitHub issue `[Nightly Regression] ...` created automatically.

Actions:
1. Open linked workflow run and inspect JUnit artifact.
2. Identify first failing test and reproduce locally.
3. If flaky, quarantine with issue + follow-up test hardening.
4. If regression, fix before new feature merges.

## Operational commands

```bash
py -m pytest -q tests/test_filters_frontend_contracts.py
py -m pytest -q tests/test_trends_history_summary.py
py -m pytest -q tests/test_e2e_mocked_ci_collect_and_app.py
```
