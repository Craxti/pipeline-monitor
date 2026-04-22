# CI/CD Monitor

<p align="center">
  <img src="web/static/logo-wide.png" alt="CI/CD Monitor — pipeline status at a glance" width="420" />
</p>

*One panel for CI + tests + services.*

A practical Python tool for DevOps and QA engineers that collects CI/CD pipeline statuses, parses test reports, generates reports, and optionally sends Telegram alerts and monitors Docker services.

---

## Documentation

- **Users (install/run/configure/use UI)**: `docs/USER_GUIDE.md`
- **Developers (architecture/extension points)**: `docs/DEVELOPER_GUIDE.md`
- **Workflow (Issues/PRs)**: `docs/WORKFLOW.md`

## Project links

- **Source repository**: `https://github.com/Craxti/pipeline-monitor`

## License

MIT License (2026). See `LICENSE`.

---


## Layout (high level)

```text
./
├── clients/            # Jenkins / GitLab API clients
├── parsers/            # JUnit, Allure, console parsers
├── docker_monitor/     # Container + HTTP checks
├── models/             # Shared domain models (snapshot, tests, …)
├── notifications/      # Telegram notifications
├── reports/            # Rich / CSV / HTML reports
├── tools/              # Small maintenance scripts
├── scripts/            # Helper scripts (ops / install)
├── tests/              # Unit/integration tests
├── web/
│   ├── app.py          # FastAPI app bootstrap (router wiring, lifespan)
│   ├── schemas.py      # Pydantic schemas (API IO)
│   ├── db.py           # SQLite persistence helpers (optional)
│   ├── core/           # auth, config, runtime, snapshot/trends, notifications
│   ├── routes/         # HTTP routers (ops, dashboard, collect, logs, chat, ...)
│   ├── services/       # Endpoint implementations + collect runtime + exports + AI wiring
│   ├── static/         # Dashboard JS/CSS/assets
│   └── templates/      # Jinja2 pages/partials
├── ci_monitor.py       # CLI entrypoint
├── config.example.yaml # Example defaults (first seed into DB)
├── pyproject.toml      # Tooling config (ruff/pytest/etc.)
├── requirements.txt    # Runtime dependencies
└── data/               # Runtime/generated (monitor.db, reports, ...)
```

---

## Features

| Module | Description |
|---|---|
| `clients/` | Jenkins & GitLab REST API adapters |
| `parsers/` | pytest JUnit XML + Allure JSON parsers |
| `reports/` | Console (Rich), CSV, HTML (Jinja2) |
| `notifications/` | Telegram alerts for critical job failures |
| `docker_monitor/` | Docker container state + HTTP health checks |
| `web/` | FastAPI REST API + live dashboard |

---

## Quick Start

### Run with Docker (recommended)

**Requirements:** [Docker](https://docs.docker.com/get-docker/) with Compose v2 (Docker Desktop includes it).

The repository includes a `Dockerfile` and a `compose.yml` for a **one-command start**.
No local Python is required. The app stores **all settings in SQLite** (`data/monitor.db` key `app_config_json`); on first start it seeds from `config.example.yaml` if the DB is empty. Edit later via **Settings** in the UI.

**From a fresh clone**

```bash
git clone https://github.com/Craxti/pipeline-monitor.git
cd pipeline-monitor
docker compose up -d --build
# Dashboard: http://127.0.0.1:8020/health
```

**Already in the repo folder**

```bash
# 1) Build and start in background
docker compose up -d --build

# 2) Open the dashboard
# http://127.0.0.1:8020

# 3) See logs (optional)
docker compose logs -f

# 4) Stop
docker compose down
```

**Prebuilt image (when published to GHCR; tag may be `main` or `latest`)**

```bash
docker pull ghcr.io/craxti/pipeline-monitor:latest
docker run --rm -d --name pipeline-monitor-web -p 8020:8020 \
  -e CICD_MON_DATA_DIR=/app/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v pipeline-monitor-data:/app/data \
  ghcr.io/craxti/pipeline-monitor:latest
```

If the first pull 404s, the image is not published yet: use `docker compose up -d --build` from a clone, or your fork’s `ghcr.io/<fork-owner>/<repo>:<tag>`. After you push, open the latest **Actions** run for the **Docker publish** workflow and confirm the **Build and push** step is green; if it failed, the image is not in GHCR yet. A successful push appears under **GitHub → Packages** for the repo (not under **Code** in the file tree). Private images require `docker login ghcr.io` before `docker pull`.

Notes:
- **Config + history DB**: stored in Docker volume `pipeline-monitor-data` as `/app/data/monitor.db` (settings + `meta` + historical tables).
- **Docker monitoring from the container** (optional): mount `/var/run/docker.sock` as in the `docker run` example and `compose.yml`.
- **Port**: `8020:8020` (change the host side in `compose.yml` if needed, e.g. `9080:8020`).
- **API token (optional)**: set `CICD_MON_API_TOKEN` in `compose.yml` or `web.api_token` in **Settings** (saved in the DB).

### Run with Docker (without compose)

```bash
docker build -t pipeline-monitor-web:local .
```

**Linux / macOS (named volumes, same as Compose)**

```bash
docker run --rm -d --name pipeline-monitor-web -p 8020:8020 \
  -e CICD_MON_DATA_DIR=/app/data \
  -e PYTHONUNBUFFERED=1 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v pipeline-monitor-data:/app/data \
  --restart unless-stopped \
  pipeline-monitor-web:local
```

**PowerShell**

```powershell
docker run -d --name pipeline-monitor-web -p 8020:8020 `
  -e CICD_MON_DATA_DIR=/app/data `
  -e PYTHONUNBUFFERED=1 `
  -v /var/run/docker.sock:/var/run/docker.sock `
  -v pipeline-monitor-data:/app/data `
  --restart unless-stopped `
  pipeline-monitor-web:local
```

Settings and history live in `monitor.db` on the `pipeline-monitor-data` volume; use **Settings** in the UI or a DB backup to change configuration.

**Migrating an old `config.yaml` into the DB:** on first start with an empty `monitor.db`, the app will import a file at `/app/config.yaml` if you mount it (read-only is fine), e.g. `-v /path/to/config.yaml:/app/config.yaml:ro` for one run, then remove the mount.

### 1. Install dependencies

```bash
py -m pip install -r requirements.txt
```

### 2. Configure

Use **Settings** in the web UI (or seed/migrate: optional local `config.yaml` is read once to populate the DB on first start if the DB is empty; primary store is `data/monitor.db`). At minimum, enable the systems you use in Settings.
The current config supports **multiple Jenkins and GitLab instances**.

```yaml
jenkins_instances:
  - name: "Jenkins"
    enabled: true
    url: "http://your-jenkins:8080"
    username: "admin"
    token: "your-api-token"
    jobs:
      - name: "backend-build"
        critical: true
        parse_console: true
    max_builds: 10
    show_all_jobs: false
    verify_ssl: true

gitlab_instances:
  - name: "GitLab"
    enabled: true
    url: "https://gitlab.example.com"
    token: "glpat-xxxxxxxxxxxx"
    projects:
      - id: "mygroup/myrepo"
        critical: true
    max_pipelines: 10
    show_all_projects: false

docker_monitor:
  enabled: false

web:
  host: "0.0.0.0"
  port: 8020
```

### 3. Collect data and generate reports

```bash
# Collect last 7 days, print to console
py ci_monitor.py collect

# Collect and output all formats (console + CSV + HTML)
py ci_monitor.py collect --format all

# Collect from yesterday only
py ci_monitor.py collect --from yesterday --format html

# Short one-line summary
py ci_monitor.py collect --format console --short

# Parse only local test logs (no CI connection needed)
py ci_monitor.py collect --format all
```

### 4. Re-generate reports from last snapshot

```bash
py ci_monitor.py report --format html
py ci_monitor.py report --format csv
```

### 5. Start the web dashboard

```bash
py ci_monitor.py web
# open http://127.0.0.1:8020 (or whatever web.host/web.port are)
```

If the page never finishes loading while `web.live_reload` is `true`, set it to `false` in **Settings** (saved in `data/monitor.db`). Uvicorn’s `--reload` restarts the worker when files under `web/` change; rapid restarts (IDE, formatters) can interrupt the browser. Reload mode watches only the `web/` tree, not the whole repo.

The dashboard shows:
- Builds / pipelines (Jenkins & GitLab)
- Tests (from CI console / Allure, plus local parsers)
- Services (Docker + HTTP checks)
- Trends, incident center, and collect logs

#### Protecting sensitive endpoints (shared token)

You can require a shared token (header) for dangerous endpoints: saving settings, manual collect, action triggers, webhook ingest, log viewers, and AI chat.

- **Header**: `X-API-Token: <token>`
- **Alternative**: `Authorization: Bearer <token>`

Configure either:

- **Environment variable**: `CICD_MON_API_TOKEN`
- **Settings / DB**: `web.api_token: "<token>"` in the app config (stored in `data/monitor.db`)

If no token is configured, auth is **disabled** for backward compatibility.

#### Local AI (Ollama)

If you run Ollama locally, you can point the dashboard AI provider to an OpenAI-compatible endpoint:

- **base URL**: `http://127.0.0.1:11434/v1`
- **model**: `llama3.1:8b`

### 6. Check Docker / HTTP services

```bash
# Enable docker_monitor in Settings first
py ci_monitor.py docker-check
```

### 7. Send Telegram notifications

```bash
# Enable notifications in Settings, then:
py ci_monitor.py collect --notify
# or standalone:
py ci_monitor.py notify
```

---

## CLI Reference

```
py ci_monitor.py [--config FILE.yaml] [--log-level LEVEL] COMMAND [OPTIONS]

Omit `--config` to use the same settings as the web app (stored in `data/monitor.db`).

Commands:
  collect       Collect CI/CD data and generate reports
  report        Re-generate reports from last snapshot
  web           Start FastAPI dashboard
  docker-check  Run Docker/HTTP health checks
  notify        Send notifications from last snapshot

collect options:
  --from TEXT   Lookback window: yesterday | today | week | month | Nd | YYYY-MM-DD | all
  --format      console | csv | html | all
  --short       One-line summary instead of full table
  --notify      Send notifications after collecting
```

---

## Configuration Reference (Settings / `monitor.db`; shape matches YAML)

```yaml
general:
  project_name: "CI/CD Monitor"
  default_lookback_days: 7
  data_dir: "data"
  log_level: "INFO"

jenkins_instances:
  - name: "Jenkins"
    enabled: false
    url: "http://jenkins.example.com"
    username: ""
    token: ""
    jobs:
      - name: "backend-build"
        critical: true        # alerts + incident signals
        parse_console: true   # parse tests from console (if enabled)
    max_builds: 10
    show_all_jobs: false      # if true, pulls job list from Jenkins and uses limits below
    show_all_limit_jobs: 25
    parse_console: false
    console_jobs_limit: 25
    console_builds: 5
    parse_allure: false
    allure_jobs_limit: 25
    allure_builds: 5
    verify_ssl: true

gitlab_instances:
  - name: "GitLab"
    enabled: false
    url: "https://gitlab.example.com"
    token: ""
    projects:
      - id: "mygroup/myrepo"
        critical: true
    max_pipelines: 10
    show_all_projects: false

parsers:
  pytest_xml_dirs:
    - "sample_logs"        # scanned recursively for *.xml
  allure_json_dirs:
    - "sample_logs"        # scanned for *-result.json
  top_failures: 5

reports:
  output_dir: "data"
  csv_filename: "ci_report.csv"
  html_filename: "ci_report.html"
  console_mode: "detailed" # or "short"

notifications:
  telegram:
    enabled: false
    # New format: multiple bots (preferred)
    bots:
      - enabled: true
        bot_token: ""
        chat_id: ""
        critical_only: true
        api_base_url: ""    # optional self-hosted Bot API base (SSRF-guarded)
    # Legacy flat format is still supported:
    # bot_token: ""
    # chat_id: ""
    # critical_only: true

docker_monitor:
  enabled: false
  show_all_containers: true
  containers: []           # empty = watch all running containers
  http_checks:
    - name: "api"
      url: "http://localhost:8000/health"
  timeout_seconds: 5

web:
  host: "0.0.0.0"
  port: 8020
  live_reload: true
  auto_collect: false
  collect_interval_seconds: 300
  api_token: ""            # optional shared token (see above)

# AI / LLM settings used by the dashboard chat endpoint.
# Despite the key name, this block supports multiple providers (incl. Ollama).
openai:
  provider: "ollama"        # ollama | openai | gemini | openrouter | cursor | ...
  api_key: ""               # often empty for local ollama
  model: "llama3.1:8b"
  base_url: "http://127.0.0.1:11434/v1"
```

---

## Webhook Integration

The web server exposes a webhook endpoint so CI systems can push events directly:

```bash
# Start the web server
py ci_monitor.py web

# Trigger from Jenkins post-build step / GitLab CI job
curl -X POST http://127.0.0.1:8020/webhook/build-complete \
  -H "Content-Type: application/json" \
  -d '{"source":"jenkins","job":"backend-build","status":"failure","build_number":143,"critical":true}'
```

Note: the webhook is protected by the shared token if `CICD_MON_API_TOKEN` / `web.api_token` is set.

---

## Cron / Scheduled Runs

**Linux/macOS** (`crontab -e`):
```cron
# Every hour: collect data and send notifications
0 * * * * cd /path/to/pipeline-monitor && /usr/bin/python3 ci_monitor.py collect --format all --notify
```

**Windows Task Scheduler** (or `.bat`):
```bat
py ci_monitor.py collect --format all --notify
```

---

## Project Structure

```
pipeline-monitor/
├── ci_monitor.py          # Main CLI entry point
├── config.example.yaml    # Example seed (imported into DB on first start)
├── config_migrations.py   # Config migrations/helpers
├── requirements.txt       # Runtime dependencies
├── pyproject.toml         # Tooling config (ruff/pytest/etc.)
│
├── clients/               # Jenkins/GitLab adapters
├── parsers/               # JUnit/Allure/console parsers
├── reports/               # Console/CSV/HTML reports
├── notifications/         # Telegram notifier(s)
├── docker_monitor/        # Docker + HTTP checks
├── web/                   # FastAPI app + dashboard UI
│   ├── routes/            # Routers
│   ├── services/          # Endpoint implementations + runtime
│   ├── static/            # JS/CSS/assets
│   └── templates/         # Jinja2 pages/partials
│
└── data/                  # Runtime/generated (monitor.db, reports, ...)
```

---

## Adding New CI Systems

1. Create `clients/bitbucket_client.py` inheriting from `BaseCIClient`
2. Implement `fetch_builds()` returning `list[BuildRecord]`
3. Import and call it in `ci_monitor.py` inside the `collect` command

## Adding New Report Parsers

1. Create `parsers/testng_parser.py` inheriting from `BaseParser`
2. Set `glob_pattern` and implement `parse_file()` returning `list[TestRecord]`
3. Add its directory config under `parsers:` in **Settings** (same shape as the reference below)

---

## REST API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Live web dashboard |
| `GET` | `/health` | Health check |
| `GET` | `/api/status` | Full snapshot JSON |
| `GET` | `/api/builds` | Build records list |
| `GET` | `/api/tests` | Test records list |
| `GET` | `/api/tests/top-failures?n=10` | Top N failing tests |
| `GET` | `/api/services` | Service health list |
| `GET` | `/api/trends` | Trends time series |
| `GET` | `/api/incident.json` | Incident export (JSON) |
| `GET` | `/api/incident.md` | Incident export (Markdown) |
| `GET` | `/api/collect/status` | Background collect state |
| `GET` | `/api/collect/logs` | Live collect logs for UI |
| `GET` | `/api/collect/slow` | Top slow operations during collect |
| `POST` | `/api/collect` | Trigger manual collect (token-protected if enabled) |
| `POST` | `/webhook/build-complete` | Receive build events (token-protected if enabled) |

---

## Demo (no CI connection needed)

```bash
# Re-generate reports from the last collected snapshot (stored in data/monitor.db)
py ci_monitor.py report --format html
py ci_monitor.py report --format csv

# Optional: collect using your local parsers (configure `parsers.*_dirs` in Settings)
# py ci_monitor.py collect --format all

# Start dashboard
py ci_monitor.py web
# open http://127.0.0.1:8020
```
