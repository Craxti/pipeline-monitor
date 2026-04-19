# CI/CD Monitor — Developer Guide

This guide is for developers contributing to the codebase. It is written to match the current repository structure and wiring (FastAPI composed via `web/services/app_composer.py`, CLI via `ci_monitor.py`).

## Project links

- **Source repository**: `https://github.com/Craxti/pipeline-monitor`
- **License**: MIT (2026), see `LICENSE`

## Quick orientation

### Main entry points

- **CLI**: `ci_monitor.py`
- **Web app object**: `web/app.py` (thin wrapper exporting `app` from composer)
- **Actual FastAPI wiring**: `web/services/app_composer.py`

### Runtime data files

By default, runtime artifacts are written under `general.data_dir` (default: `data/`):

- `data/monitor.db` — SQLite database holding:
  - latest dashboard snapshot JSON (`meta.latest_snapshot_json`)
  - persisted UI event feed (`meta.event_feed_json`)
  - daily trends buckets (`meta.trends_history_json`)
  - historical builds/tests/services rows for analytics
- On first startup after an upgrade, if those `meta` keys are empty but legacy `snapshot.json` / `event_feed.json` / `trends.json` exist in the same directory, they are imported once (you may delete the old JSON files afterward).

### Why “services” exist

The `web/services/` package is used to keep:

- route handlers thin and testable
- wiring explicit (dependency injection by passing functions/modules)
- circular imports under control (routes import `web.core.runtime` instead of importing `web.app`)

## Repo structure (current)

High-signal directories:

- `clients/`: CI providers (Jenkins, GitLab) HTTP clients
- `parsers/`: test result parsers (pytest JUnit XML, Allure JSON, Jenkins console / Jenkins Allure)
- `docker_monitor/`: Docker + HTTP checks
- `models/`: shared domain models (snapshot, build/test/service records)
- `reports/`: console (Rich), CSV, HTML exporters
- `notifications/`: Telegram integration
- `web/`: FastAPI app, routes, UI templates/static, and “service” modules
- `tests/`: unit/contract tests

## Local development

### Environment

- Python 3.9+
- Recommended: virtualenv in `.venv/`

```bash
py -m venv .venv
.\.venv\Scripts\activate
py -m pip install -r requirements.txt
```

### Run the web UI (developer mode)

Either:

```bash
py ci_monitor.py web
```

Or:

```bash
py -m uvicorn web.app:app --host 0.0.0.0 --port 8080 --reload
```

### Lint/format

If you have `make`:

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

## Web app composition (how it starts)

### Config resolution

The web process resolves configuration via `web/core/config.py`:

- Prefer `REPO_ROOT/config.yaml`
- Fallback to `./config.yaml` if current working directory is different (common with `uvicorn`)
- Apply migrations: `config_migrations.migrate_telegram_notifications`
- Normalize legacy single-instance keys (`jenkins`, `gitlab`) into `jenkins_instances` / `gitlab_instances`

### Lifespan wiring

The FastAPI app is created in `web/services/app_composer.py`. It builds a lifespan function using:

- `web/services/app_lifespan_wiring.make_app_lifespan(...)`
- `web/core/runtime` for process-wide state (snapshot cache, collect state/logs, SSE runtime, revision counter, etc.)
- Optional SQLite initialization via `web/services/sqlite_imports.py`
- Optional “Cursor proxy” lifecycle via `web/services/cursor_proxy*` (controlled by config)

## Shared runtime state (`web/core/runtime.py`)

The web process stores shared state in one module to avoid circular imports:

- **Snapshot cache** and async loader
- **Collect state** (is collecting, timestamps, interval)
- **Collect logs** and “slow operations” list
- **Event feed** persistence
- **SSE hub runtime** for `/api/stream/events`
- **Revision counter** to let UI invalidate caches
- **Instance health** snapshot (per configured source)

When you change data that the UI reads, bump the revision where appropriate (many endpoints include `data_revision`).

## Auth / security model (shared token)

Sensitive endpoints can be protected by a shared token:

- Expected token resolves from:
  - env: `CICD_MON_API_TOKEN`
  - config: `web.api_token`
- Request may provide token via:
  - `X-API-Token`
  - `Authorization: Bearer <token>`

Implementation: `web/core/auth.py` → `require_shared_token`.

Important behavior: **if no expected token is configured, auth is disabled** (backward compatibility).

## Key HTTP routes (where to look)

Routers are composed in `web/services/app_composer.py` from `web/routes/*`.

High-signal route modules:

- `web/routes/dashboard.py`:
  - `/` HTML
  - `/api/status`, `/api/meta`, `/api/trends`, `/api/uptime`
  - `/api/stream/events` (SSE)
  - analytics endpoints (`/api/analytics/*`)
  - SQLite diagnostics (`/api/db/stats`)
- `web/routes/settings.py`:
  - `GET /settings` HTML
  - `GET /api/settings/public` (no token)
  - `GET /api/settings` (token)
  - `POST /api/settings` (token) saves YAML and restarts collect loop
- `web/routes/webhooks.py`:
  - `POST /webhook/build-complete` (token) triggers collect scheduling
- `web/routes/ops.py`:
  - `GET /health`, `GET /ready` style endpoints (see file for exact paths)

If you update endpoint behavior, keep `README.md` and user docs in sync.

## Collection pipeline (web mode)

Web-triggered collection is orchestrated by `web/services/collect_tasks.py` and related modules. The general pattern is:

- A route creates an asyncio task (to keep requests responsive).
- The task calls `collect_tasks.do_collect(...)`.
- The collector:
  - updates `web.core.runtime.collect_state`
  - appends human-readable progress logs to `collect_logs`
  - emits SSE events (via `web/services/collect_runtime_api.sse_broadcast_async`)
  - saves snapshot files via `web/services/collect_entrypoints.save_snapshot*`

CLI collection is separate (`ci_monitor.py collect`) but ultimately writes the same snapshot model and calls `web.app.save_snapshot(...)` to update the web-side storage as well.

## Snapshot persistence & SQLite dual-write

### Primary storage: JSON files

The system is designed so the dashboard can run from JSON files without a database.

### Optional storage: SQLite history DB

`web/db.py` implements an **append-only history** store:

- Tables: `snapshots`, `builds`, `tests`, `services`, and `collector_state`
- It is initialized via `init_db(data_dir)` which creates `data/monitor.db`
- On each snapshot save, the system can append build/test/service rows so historical queries become possible (sparklines, flaky analysis, uptime by day)

The rest of the app imports SQLite via `web/services/sqlite_imports.py` to gracefully handle environments where SQLite features are unavailable.

If you add a new historical query, add it to `web/db.py` and expose it through `sqlite_imports.py`, then consume it in a route/service with a clear “sqlite_available” guard.

## Settings save behavior (secrets-safe)

`POST /api/settings` writes YAML back to `config.yaml`.

To avoid losing secrets when UI sends masked values, settings merge uses:

- `web/core/settings_secrets.merge_settings_secrets(...)`
- `web/core/settings_secrets.mask_settings_for_response(...)`

When extending config:

- add fields to `config.example.yaml`
- ensure public settings exposure stays safe (`web/services/settings_public.py`)
- update masking rules if the field contains secrets

## Adding a new CI source

Recommended approach:

- Add a client in `clients/`
- Add a “collect sync” implementation in `web/services/collect_sync/` (web mode)
- Wire it into:
  - CLI (`ci_monitor.py`) if you want it available in CLI collection
  - web collect orchestrator if you want it in dashboard mode

Keep the output model consistent with `models.models.CISnapshot` (build/test/service records).

## Adding a new test parser

- Implement parser in `parsers/` (similar shape to `PytestXMLParser` / `AllureJsonParser`)
- Add config keys under `parsers:` in `config.example.yaml`
- Wire parsing into `ci_monitor.py collect` (CLI) and/or web collect sync path (web mode)

## Testing

Tests live in `tests/`. Run them with:

```bash
py -m pytest -q
```

If a test is a “contract” test for backward-compatible exports from `web/app.py`, keep the re-exports intact (see `web/app.py`).

## Docs maintenance policy

When changing behavior, update documentation in the same PR:

- `README.md` (overview and quick start)
- `docs/USER_GUIDE.md` (operational usage)
- `docs/DEVELOPER_GUIDE.md` (architecture/extension points)

