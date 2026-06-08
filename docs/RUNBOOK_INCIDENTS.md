# Runbook: Typical Incidents

## Scope

Operational runbook for common CI/CD Monitor incidents in web mode (SQLite settings + snapshot in `data/monitor.db`).

## Incident 1: Dashboard shows stale data

Symptoms:

- stale badge/warning is visible
- snapshot age keeps growing

Actions:

1. Open `/api/collect/status` and verify `is_collecting`.
2. Trigger manual collect from the Collect panel (or `POST /api/collect` with token).
3. Inspect collect logs in the UI or `GET /api/collect/logs`.
4. Check `/health` and `/ready`.
5. Verify source credentials via Settings → Test connection.

Escalate if collect repeatedly fails for >15 minutes.

## Incident 2: Filters persist after reset

Symptoms:

- user clicks reset, refreshes page, old filters return.

Actions:

1. Verify URL query string was cleared.
2. Verify corresponding localStorage keys `cimon-f-*`.
3. Validate clear handlers call `_persistFiltersFromForm()`.
4. Re-run `tests/test_filters_frontend_contracts.py`.

See `docs/HOW_FILTERS_WORK_END_TO_END.md`.

## Incident 3: Trends KPI differs from charts

Symptoms:

- Trends chart filtered by instance, KPI still shows global values.

Actions:

1. Confirm selected source/instance in Trends toolbar.
2. Check request to `/api/trends/history-summary` includes `source` and `instance`.
3. Confirm history rows include per-instance slices.
4. Run trends-related tests (e.g. `tests/test_snapshot_trends_cache.py`).

See `docs/KPI_FAQ.md`.

## Incident 4: Service incident stuck open

Symptoms:

- Incidents tab shows open incident after service recovered
- Notifications still reference old anomaly

Actions:

1. Check service status on Services tab — incident auto-resolves when status returns to `up`.
2. Inspect `/api/service-incidents` for incident `status` and `updated_at`.
3. Verify log intelligence loop is running (check app logs on startup for log intel loop).
4. If false positive: resolve manually in UI or clear via DB maintenance (last resort).
5. Re-run `tests/test_service_intel_incidents.py`.

## Incident 5: External service monitor empty

Symptoms:

- Services tab missing Zabbix/Prometheus/etc. entries
- Collect logs show service_monitors phase skipped or errors

Actions:

1. Confirm `service_monitors.enabled: true` in Settings.
2. Test each instance via Settings → Test connection.
3. Check network/firewall from monitor host to target API.
4. Inspect collect logs for `service_monitors` slow-step entries.
5. Run `tests/test_service_monitors.py`.

## Incident 6: Settings lost after container restart

Symptoms:

- Jenkins/GitLab credentials gone after Docker restart

Actions:

1. Confirm Docker volume `pipeline-monitor-data` is mounted to `/app/data`.
2. Verify `CICD_MON_DATA_DIR=/app/data` in container env.
3. Do not bind-mount an empty host directory over `/app/data` without backup.
4. Restore from `monitor.db` backup if volume was recreated.

## Incident 7: Nightly regression alert opened

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
py -m pytest -q tests/test_snapshot_trends_cache.py
py -m pytest -q tests/test_e2e_mocked_ci_collect_and_app.py
py -m pytest -q tests/test_service_monitors.py
py -m pytest -q tests/test_service_intel_incidents.py
```
