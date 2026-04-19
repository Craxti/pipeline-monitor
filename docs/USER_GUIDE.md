# CI/CD Monitor — User Guide

This guide is for **end users** (DevOps/QA/engineering teams) who want to run the dashboard and collectors. It is written to match the current repository code.

## Project links

- **Source repository**: `https://github.com/Craxti/pipeline-monitor`
- **License**: MIT (2026), see `LICENSE`

## What this project does

CI/CD Monitor collects and displays:

- **Builds / pipelines** from **Jenkins** and/or **GitLab**
- **Test results** from:
  - Jenkins console parsing (optional)
  - Jenkins Allure parsing (optional)
  - Local parsers: **pytest JUnit XML** and **Allure JSON** directories
- **Service health** from:
  - Docker container status (optional)
  - HTTP checks (optional)
- **Trends / uptime** computed from historical data files, and optionally SQLite history

You can use it in two ways:

- **CLI mode**: `collect` and `report` commands generate console/CSV/HTML output.
- **Web mode**: a **FastAPI** dashboard with live UI and APIs.

## Requirements

- **Python**: 3.9+ (project targets py39)
- Network access to your Jenkins/GitLab (if enabled)
- Optional: local Docker Engine access (if `docker_monitor.enabled: true`)
- Optional: a Telegram bot token/chat id (if notifications are enabled)
- Optional: local Ollama (if you want local AI chat via OpenAI-compatible API)

## Install

From the repo root:

```bash
py -m venv .venv
.\.venv\Scripts\activate
py -m pip install -r requirements.txt
```

## Configuration (`config.yaml`)

The app reads configuration from `config.yaml` in the **repo root** (preferred) or current working directory.

- Example template: `config.example.yaml`
- Actual runtime config: `config.yaml`

### Security warning (tokens)

Your `config.yaml` may contain **secrets** (Jenkins tokens, GitLab PATs, Telegram bot tokens).

- Do **not** commit secrets to git.
- Prefer environment variables where supported.
- The web UI “Settings” endpoint supports masking/merging secrets so you can update non-secret fields without accidentally wiping secrets.

### Minimal web config

```yaml
web:
  host: 0.0.0.0
  port: 8000
  live_reload: true
```

### Jenkins (one or more instances)

```yaml
jenkins_instances:
  - name: Jenkins
    enabled: true
    url: "https://jenkins.example.com/"
    username: "user"
    token: "api-token"

    # Either specify explicit jobs OR enable "show all jobs"
    jobs:
      - name: "backend-build"
        critical: true
        parse_console: true

    # How much history to fetch (0 can mean “no limit” in some paths; prefer explicit numbers)
    max_builds: 10

    # Optional parsers for tests
    parse_console: true
    console_builds: 5
    parse_allure: false

    # Bulk discovery mode
    show_all_jobs: false
    show_all_limit_jobs: 25

    # TLS
    verify_ssl: true
```

Notes:

- If `show_all_jobs: true`, the collector will **discover jobs** and apply limits (`show_all_limit_jobs`, `console_jobs_limit`, etc.).
- `verify_ssl: false` is supported for internal/self-signed Jenkins, but is not recommended for public networks.

### GitLab (one or more instances)

```yaml
gitlab_instances:
  - name: GitLab
    enabled: true
    url: "https://gitlab.example.com/"
    token: "glpat-..."
    projects:
      - id: "mygroup/myrepo"   # or numeric project id depending on your GitLab
        critical: true
    max_pipelines: 10
    show_all_projects: false
```

If `show_all_projects: true`, the collector will try to discover projects (subject to GitLab permissions and internal limits).

### Local test parsers (no CI needed)

```yaml
parsers:
  pytest_xml_dirs:
    - "sample_logs"
  allure_json_dirs:
    - "sample_logs"
  top_failures: 100
```

### Docker & HTTP checks

```yaml
docker_monitor:
  enabled: true
  show_all_containers: true
  containers: []   # empty = all running containers
  http_checks:
    - name: "internal-api"
      url: "http://127.0.0.1:8080/health"
  timeout_seconds: 5
```

### Telegram notifications

```yaml
notifications:
  telegram:
    enabled: true
    bots:
      - enabled: true
        bot_token: "123:abc"
        chat_id: "12345678"
        critical_only: true
        api_base_url: ""   # optional; can point to a self-hosted Bot API
```

### Protecting sensitive web endpoints (shared API token)

Some endpoints are “dangerous” (saving settings, triggering collect, webhook ingest, logs viewer, actions, AI chat).
You can protect them with a shared token.

Configure **either**:

- Environment variable: `CICD_MON_API_TOKEN`
- `config.yaml`: `web.api_token: "<token>"`

Clients must send one of:

- `X-API-Token: <token>`
- `Authorization: Bearer <token>`

If no token is configured, auth is **disabled** for backward compatibility.

## Running (CLI)

### Collect snapshot + reports

```bash
py ci_monitor.py collect
py ci_monitor.py collect --from week --format all
py ci_monitor.py collect --from 7d --format html
py ci_monitor.py collect --from 2026-04-01 --format csv
```

The `--from` argument supports:

- `yesterday`, `today`, `week`, `month`, `all`
- `Nd` (example: `7d`)
- ISO date `YYYY-MM-DD`

### Re-generate reports from last snapshot

```bash
py ci_monitor.py report --format console
py ci_monitor.py report --format all
```

### Docker/HTTP checks only

```bash
py ci_monitor.py docker-check
```

### Notifications only

```bash
py ci_monitor.py notify
```

## Running (Web dashboard)

### Start via CLI (recommended)

```bash
py ci_monitor.py web
```

It will read `web.host`, `web.port`, and `web.live_reload` from `config.yaml`.

### Start via Uvicorn directly (dev workflow)

```bash
py -m uvicorn web.app:app --host 0.0.0.0 --port 8000 --reload
```

### Live reload caveat

If the browser keeps “spinning” and never loads while `web.live_reload: true`, disable it:

```yaml
web:
  live_reload: false
```

Uvicorn reload restarts workers frequently; rapid file changes from IDE tooling can interrupt long-polling/SSE connections.

## Using the UI

### Pages

- `/`: Main dashboard
- `/settings`: Settings UI

### What to expect on the dashboard

- **Sources**: Jenkins/GitLab instances and their health
- **Builds**: latest builds/pipelines, critical highlighting, links
- **Tests**: failures/top failures (from snapshot)
- **Services**: Docker/HTTP checks status
- **Trends/Uptime**: historical charts computed from stored history
- **Collect**: last collection state/logs and “manual collect” controls (may be token-protected)

## Files written to `data/`

The dashboard snapshot, persisted event feed, and trends history are stored **inside** `monitor.db` (SQLite `meta` table). Historical build rows for analytics are stored in the same database.

Common outputs under `general.data_dir` (default `data/`):

- `monitor.db`: SQLite — latest snapshot, event feed, trends history, plus historical tables for `/api/builds/history`, sparklines, flaky analysis, etc.
- `ci_report.csv`, `ci_report.html`: reports (if generated)
- If you previously used JSON files (`snapshot.json`, `event_feed.json`, `trends.json`), they are migrated into `monitor.db` automatically on first open when the corresponding `meta` keys are still empty.

## Webhook integration

The server accepts:

- `POST /webhook/build-complete` (token-protected if shared token is configured)

Typical flow: your CI triggers this webhook after a build finishes, and CI/CD Monitor schedules a collection to refresh the dashboard.

Example:

```bash
curl -X POST "http://127.0.0.1:8000/webhook/build-complete" ^
  -H "Content-Type: application/json" ^
  -H "X-API-Token: YOUR_TOKEN" ^
  -d "{\"source\":\"jenkins\",\"job\":\"backend-build\",\"status\":\"failure\",\"build_number\":143,\"critical\":true}"
```

## Troubleshooting

### “401 Unauthorized” on API calls

- You configured `CICD_MON_API_TOKEN` or `web.api_token`
- But your client/UI request does not include `X-API-Token` or `Authorization: Bearer ...`

Fix: add the header, or temporarily remove the token configuration.

### Dashboard loads, but shows no data

- Run `py ci_monitor.py collect` at least once (writes the latest snapshot into `monitor.db` under `general.data_dir`)
- Ensure `general.data_dir` in `config.yaml` is the directory where `monitor.db` is created/updated
- Check CI connectivity (Jenkins/GitLab URL, tokens, SSL verification)

### Jenkins SSL errors

Set `verify_ssl: false` for that Jenkins instance in `config.yaml` (internal/self-signed only).

### Docker checks fail on Windows

- Ensure Docker Desktop is running and the engine is accessible
- If you only need HTTP checks, keep `docker_monitor.enabled: true` but set `show_all_containers: false` and list only `http_checks`

## Where to go next

- Developer guide: `docs/DEVELOPER_GUIDE.md`

