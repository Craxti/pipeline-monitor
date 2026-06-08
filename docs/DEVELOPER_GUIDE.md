# CI/CD Monitor — Developer Guide

This guide is for developers contributing to the codebase. It matches the current repository structure and wiring.

## Project links

- **Source repository**: `https://github.com/Craxti/pipeline-monitor`
- **License**: MIT (2026), see `LICENSE`

## Quick orientation

### Main entry points

- **CLI**: `ci_monitor.py`
- **Web app object**: `web/app.py` (thin wrapper exporting `app` from composer)
- **Actual FastAPI wiring**: `web/services/app_composer.py`

### Runtime data (`monitor.db`)

By default, runtime artifacts live under `general.data_dir` (default: `data/monitor.db`):

| Store | Location | Purpose |
|---|---|---|
| Settings | `meta.app_config_json` | Full app configuration (primary) |
| Snapshot | `meta.latest_snapshot_json` | Latest dashboard snapshot |
| Event feed | `meta.event_feed_json` | Persisted UI events |
| Trends | `meta.trends_history_json` | Daily trend buckets |
| History | `builds`, `tests`, `services` tables | Analytics queries |
| Service incidents | `service_incidents` table | Log intelligence incidents |
| Collector state | `collector_state` table | Incremental collect watermarks |

On first startup, if `app_config_json` is empty, config is seeded from legacy `config.yaml` or `config.example.yaml`. Legacy JSON snapshot files are imported once if present.

### Why `web/services/` exists

The `web/services/` package keeps:

- route handlers thin and testable
- wiring explicit (dependency injection by passing functions/modules)
- circular imports under control (routes import `web.core.runtime` instead of `web.app`)

## Repo structure (current)

High-signal directories:

- `clients/`: CI providers — Jenkins, GitLab, GitHub HTTP clients
- `parsers/`: test result parsers (pytest JUnit XML, Allure JSON, Jenkins console / Jenkins Allure)
- `service_monitors/`: external monitoring adapters (Zabbix, Prometheus, DB probes, …)
- `docker_monitor/`: local/remote Docker + HTTP checks
- `models/`: shared domain models (`CISnapshot`, build/test/service records)
- `reports/`: console (Rich), CSV, HTML exporters
- `notifications/`: Telegram integration
- `web/`: FastAPI app, routes, UI templates/static, service modules
- `web/services/collect_sync/`: web-mode collect phases (Jenkins, GitLab, GitHub, Docker, service monitors)
- `web/services/log_intelligence/`: log anomaly detection, incident store, notifier
- `tests/`: unit/contract/integration tests

## Local development

### Environment

- Python 3.9+
- Recommended: virtualenv in `.venv/`

```bash
py -m venv .venv
.\.venv\Scripts\activate
py -m pip install -r requirements.txt
```

### Run the web UI

```bash
py ci_monitor.py web
# or
py -m uvicorn web.app:app --host 0.0.0.0 --port 8020 --reload
```

### Lint/format

With `make`:

```bash
make lint
make lint-fix
```

Without `make` (Windows):

```bash
py -m ruff check .
py -m ruff format --check .
py -m black --check web/routes web/services web/schemas.py
```

### Tests

```bash
py -m pytest -q
```

## Web app composition

### Config resolution

`web/core/config.py`:

- **Primary store**: SQLite `monitor.db` → `meta.app_config_json`
- **Bootstrap**: `CICD_MON_DATA_DIR` env, legacy `config.yaml` `general.data_dir`, or default `data/`
- **First run**: migrate legacy YAML or seed from `config.example.yaml`
- **Normalize**: legacy `jenkins`/`gitlab` keys → `jenkins_instances`/`gitlab_instances`; Telegram bot migration via `config_migrations`

`load_yaml_config()` name is kept for backward compatibility; it reads from DB, not YAML.

`save_app_config()` writes merged config back to DB and refreshes in-memory cache.

### Lifespan wiring

FastAPI app is created in `web/services/app_composer.py`:

- `web/services/app_lifespan_wiring.make_app_lifespan(...)`
- `web/core/runtime` — snapshot cache, collect state/logs, SSE, revision counter
- SQLite init via `web/services/sqlite_imports.py`
- Background collect loop + log intelligence loop
- Optional Cursor proxy lifecycle (`web/services/cursor_proxy*`)

## Shared runtime state (`web/core/runtime.py`)

Process-wide state in one module (avoids circular imports):

- Snapshot cache and async loader
- Collect state, logs, slow-operation timings
- Event feed persistence
- SSE hub for `/api/stream/events`
- Revision counter (`data_revision` for UI cache busting)
- Instance health snapshot
- Auto-collect and rate-limit stores

Bump revision when data the UI reads changes.

## Auth / security model

Sensitive endpoints use shared token auth:

- Env: `CICD_MON_API_TOKEN`
- Config: `web.api_token`
- Headers: `X-API-Token` or `Authorization: Bearer`

Implementation: `web/core/auth.py` → `require_shared_token`.

**If no token is configured, auth is disabled.**

Settings secrets: `web/core/settings_secrets.py` — mask on read, merge on save so masked placeholders do not wipe real tokens.

## Key HTTP routes

Routers composed in `web/services/app_composer.py` from `web/routes/*`:

| Module | Endpoints |
|---|---|
| `dashboard.py` | `/`, `/api/status`, `/api/trends*`, `/api/uptime`, `/api/stream/events`, `/api/analytics/*` |
| `builds.py` | `/api/builds`, `/api/builds/history`, `/api/instances`, exports |
| `tests.py` | `/api/tests`, top failures, Jenkins Allure details |
| `services.py` | `/api/services` |
| `collect.py` | `/api/collect/*` (status, trigger, stop, auto, logs, slow) |
| `settings.py` | `/settings`, `/api/settings*`, test-connection, HAR analyze, reset-data |
| `service_incidents.py` | `/api/service-incidents` |
| `log_intel.py` | `/api/service-intel/*`, `/api/log-intel/*` |
| `incident.py` | CI incident bundle exports |
| `actions.py` | Jenkins/GitLab/Docker action triggers |
| `chat.py` | `/api/chat*`, proxy check |
| `webhooks.py` | `POST /webhook/build-complete` |
| `ops.py` | `/health`, `/ready` |
| `logs.py` | Pipeline log viewers |
| `system.py` | `/api/system/metrics` |

Keep `README.md` API table in sync when adding routes.

## Collection pipeline (web mode)

Orchestrated by `web/services/collect_sync/run_collect_sync.py`:

1. Jenkins (`jenkins_collect.py`) — incremental watermarks in SQLite
2. GitLab (`gitlab_collect.py`)
3. GitHub (`github_collect.py`)
4. Local parsers
5. Docker/HTTP (`docker_collect.py`) — local + remote hosts
6. Service monitors (`service_monitors_collect.py`)

Parallelism controlled by `general.parallel_collect_*` flags.

Progress flows through:

- `web.core.runtime.collect_state` / `collect_rt_state`
- SSE via `collect_runtime_api.sse_broadcast_async`
- Snapshot save via `collect_entrypoints.save_snapshot*`

CLI collection (`ci_monitor.py collect`) is separate but writes the same `CISnapshot` model to the same DB snapshot store. It currently covers Jenkins, GitLab, parsers, and Docker — not GitHub/service monitors.

## Log intelligence & service incidents

Background loop: `web/services/log_intel_loop.py`

- Tails Docker container logs and tracks external service status
- Stores models in SQLite via `log_intel_store`
- Detects anomalies → opens rows in `service_incidents` via `incident_store`
- Emits UI notifications via `log_intelligence/notifier.py`

Routes: `web/routes/log_intel.py`, `web/routes/service_incidents.py`

Frontend: `web/static/dashboard.service-incidents.js`, log intel tab scripts.

## Snapshot persistence

### Primary: SQLite meta + history tables

`web/db.py`:

- Latest snapshot JSON in `meta`
- Append-only `builds`, `tests`, `services` for analytics
- `service_incidents`, log intelligence tables
- `collector_state` for incremental Jenkins/GitLab collection
- `get_app_config_from_db` / `set_app_config_to_db` for settings

Import SQLite helpers through `web/services/sqlite_imports.py` with `SQLITE_AVAILABLE` guard.

## Settings save behavior

`POST /api/settings` → `settings_save_endpoint` → `save_app_config()` (SQLite).

Never writes secrets back as masked placeholders — uses `merge_settings_secrets`.

Public exposure: `web/services/settings_public.py` — only non-sensitive fields.

Connection tests: `web/services/settings_connection_test.py` — Jenkins, GitLab, GitHub, Docker hosts, all `MONITOR_KINDS`.

## Adding a new CI source

1. Add client in `clients/`
2. Add collect phase in `web/services/collect_sync/`
3. Wire in `run_collect_sync.py`
4. Add config block to `config.example.yaml`
5. Add connection test in `settings_connection_test.py`
6. Optionally wire CLI in `ci_monitor.py`

Output must fit `models.models.CISnapshot` (`BuildRecord`, etc.).

## Adding a new service monitor

1. Implement adapter in `service_monitors/<type>.py` using `service_monitors/base.py` helpers
2. Register type in `MONITOR_KINDS`
3. Wire `collect_instance` dispatch in `service_monitors/runner.py`
4. Add connection check in `settings_connection_test.py` (or reuse generic path)
5. Example in `config.example.yaml`

## Adding a new test parser

1. Implement in `parsers/` (see `PytestXMLParser`, `AllureJsonParser`)
2. Add config under `parsers:` in `config.example.yaml`
3. Wire into CLI (`ci_monitor.py`) and/or web collect sync

## Testing & quality gates

- Run: `py -m pytest -q`
- Contract tests may import from `web/app.py` — keep re-exports intact
- Coverage gate ~90% for critical modules (`.github/workflows/black.yml`)
- Ruff strict profile for parser/filter modules
- Mutation tests: `.github/workflows/mutation-tests.yml`
- ADR: `docs/adr/0001-quality-gates-and-mock-first-testing.md`

Key test files:

- `tests/test_service_monitors.py`, `tests/test_database_monitors.py`
- `tests/test_filters_frontend_contracts.py`
- `tests/test_service_intel_incidents.py`, `tests/test_log_intelligence.py`
- `tests/test_e2e_mocked_ci_collect_and_app.py`

## Docs maintenance policy

Update in the same PR when behavior changes:

- `README.md`
- `docs/USER_GUIDE.md`
- `docs/DEVELOPER_GUIDE.md`

Also keep aligned when relevant:

- `docs/HOW_FILTERS_WORK_END_TO_END.md`
- `docs/RUNBOOK_INCIDENTS.md`
- `docs/KPI_FAQ.md`
- `docs/WORKFLOW.md`
