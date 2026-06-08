# CI/CD Monitor — User Guide

This guide is for **end users** (DevOps/QA/engineering teams) who want to run the dashboard and collectors. It matches the current repository code.

## Project links

- **Source repository**: `https://github.com/Craxti/pipeline-monitor`
- **License**: MIT (2026), see `LICENSE`

## What this project does

CI/CD Monitor collects and displays:

- **Builds / pipelines** from **Jenkins**, **GitLab**, and/or **GitHub**
- **Test results** from:
  - Jenkins console parsing (optional)
  - Jenkins Allure parsing (optional)
  - Local parsers: **pytest JUnit XML** and **Allure JSON** directories
- **Service health** from:
  - Docker containers (local engine or remote Docker hosts)
  - HTTP checks
  - External monitoring systems via **service monitors** (Zabbix, Prometheus, Alertmanager, Uptime Kuma, Netdata, PRTG, Checkmk, HTTP JSON, Postgres/Redis/MongoDB/MySQL/Elasticsearch/Kafka)
- **Log intelligence** — container log anomaly detection, correlation graphs, and **service incidents**
- **Trends / uptime** from SQLite history
- **Telegram notifications** for critical build failures (optional)
- **AI chat** in the dashboard (Ollama, OpenAI-compatible providers, Cursor proxy)

You can use it in two ways:

- **CLI mode**: `collect` and `report` commands generate console/CSV/HTML output.
- **Web mode**: a **FastAPI** dashboard with live UI, SSE updates, and REST APIs.

## Requirements

- **Python**: 3.9+
- Network access to your CI systems (if enabled)
- Optional: Docker Engine access (local socket or remote Docker hosts)
- Optional: access to external monitoring APIs (Zabbix, Prometheus, …)
- Optional: Telegram bot token/chat id
- Optional: local Ollama or other OpenAI-compatible LLM endpoint

## Install

From the repo root:

```bash
py -m venv .venv
.\.venv\Scripts\activate
py -m pip install -r requirements.txt
```

Or use Docker (recommended for production):

```bash
docker compose up -d --build
# Dashboard: http://127.0.0.1:8020
```

## Configuration (Settings / SQLite)

**Primary store:** all settings live in SQLite at `{data_dir}/monitor.db` under the `meta.app_config_json` key (default `data/monitor.db`).

- On **first start**, if the DB is empty, the app seeds from `config.example.yaml`.
- A legacy **`config.yaml`** in the repo root or CWD is imported once if present, then settings are kept in the DB.
- Edit configuration via the **Settings** page in the UI (`/settings`) or by backing up/restoring `monitor.db`.

The CLI (`ci_monitor.py`) uses the **same DB-backed config** as the web app when `--config` is omitted.

### Environment variables

| Variable | Purpose |
|---|---|
| `CICD_MON_DATA_DIR` | Override data directory (Docker default: `/app/data`) |
| `CICD_MON_API_TOKEN` | Shared token for protected API endpoints |
| `CIMON_PROCFS_PATH` | Host procfs mount for System tab metrics in Docker |

### Security warning (tokens)

Settings may contain **secrets** (Jenkins tokens, GitLab/GitHub PATs, monitor API keys, Telegram bot tokens).

- Do **not** commit secrets to git.
- The Settings API masks secrets on read; use **Reveal** (token required) to view unmasked values.
- Use **Test connection** in Settings before saving new credentials.

### Minimal web config

```yaml
web:
  host: 0.0.0.0
  port: 8020
  live_reload: true
  auto_collect: true
  collect_interval_seconds: 300
```

### General collect tuning

```yaml
general:
  project_name: CI Monitor
  default_lookback_days: 7
  incremental_collect: true           # skip unchanged Jenkins/GitLab jobs via SQLite watermarks
  parallel_collect_sources: true        # run CI sources in parallel
  parallel_collect_instances: true
  parallel_collect_instance_workers: 6
  data_dir: data
  log_level: INFO
```

### Jenkins (one or more instances)

```yaml
jenkins_instances:
  - name: Jenkins
    enabled: true
    url: "https://jenkins.example.com/"
    username: "user"
    token: "api-token"
    jobs:
      - name: "backend-build"
        critical: true
        parse_console: true
    max_builds: 10
    parse_console: true
    console_builds: 5
    parse_allure: false
    show_all_jobs: false
    show_all_limit_jobs: 25
    show_all_history_builds: 0
    verify_ssl: true
```

Notes:

- `show_all_jobs: true` discovers jobs from Jenkins API (with caps).
- `verify_ssl: false` is supported for internal/self-signed Jenkins only.

### GitLab (one or more instances)

```yaml
gitlab_instances:
  - name: GitLab
    enabled: true
    url: "https://gitlab.example.com/"
    token: "glpat-..."
    projects:
      - id: "mygroup/myrepo"
        critical: true
    max_pipelines: 10
    show_all_projects: false
```

### GitHub (one or more instances)

```yaml
github_instances:
  - name: GitHub
    enabled: true
    url: "https://github.com"
    token: "ghp_..."
    repos:
      - id: "owner/repo"
        critical: true
    max_runs: 10
    show_all_repos: false
    verify_ssl: true
```

### External service monitors

Enable polling of Zabbix, Prometheus, Alertmanager, Uptime Kuma, Netdata, PRTG, Checkmk, custom HTTP JSON APIs, and database probes:

```yaml
service_monitors:
  enabled: true
  timeout_seconds: 15
  instances:
    - type: prometheus
      name: prod-prometheus
      enabled: true
      url: http://prometheus:9090
    - type: zabbix
      name: prod-zabbix
      enabled: true
      url: https://zabbix.example.com
      token: "..."
      mode: problems
      min_severity: 2
    - type: http_json
      name: custom-api
      enabled: true
      url: https://monitor.example.com/api/status
      items_path: data
      name_field: name
      status_field: status
      status_map:
        ok: up
        fail: down
```

Supported `type` values: `zabbix`, `prometheus`, `alertmanager`, `uptime_kuma`, `netdata`, `prtg`, `checkmk`, `http_json`, `postgres`, `redis`, `mongodb`, `mysql`, `elasticsearch`, `kafka`.

Use **Settings → Test connection** to verify credentials before saving.

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
  include_local_host: true
  docker_hosts:
    - name: prod-docker-1
      enabled: true
      host: 10.10.10.15
      username: ""
      password: ""
  show_all_containers: true
  containers: []
  http_checks:
    - name: "internal-api"
      url: "http://127.0.0.1:8080/health"
  timeout_seconds: 5
```

When running in Docker Compose, mount `/var/run/docker.sock` to monitor host containers.

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
        api_base_url: ""
```

### Protecting sensitive web endpoints (shared API token)

Protected endpoints include: saving settings, manual collect, webhook ingest, log viewers, CI/Docker actions, AI chat, HAR upload.

Configure **either**:

- Environment variable: `CICD_MON_API_TOKEN`
- Settings: `web.api_token: "<token>"`

Clients must send one of:

- `X-API-Token: <token>`
- `Authorization: Bearer <token>`

If no token is configured, auth is **disabled** for backward compatibility.

### AI / LLM (dashboard chat)

```yaml
openai:
  provider: ollama
  api_key: ""
  model: llama3.1:8b
  base_url: http://127.0.0.1:11434/v1
  cursor_proxy_autostart: false
  proxy:
    enabled: false
    type: socks5
    host: ""
    port: 0
```

Despite the key name `openai`, this block supports multiple providers (Ollama, OpenAI, Gemini, OpenRouter, Cursor, …).

## Running (CLI)

Omit `--config` to use the same DB-backed settings as the web app.

### Collect snapshot + reports

```bash
py ci_monitor.py collect
py ci_monitor.py collect --from week --format all
py ci_monitor.py collect --from 7d --format html
py ci_monitor.py collect --from 2026-04-01 --format csv
```

The `--from` argument supports: `yesterday`, `today`, `week`, `month`, `all`, `Nd` (e.g. `7d`), ISO date `YYYY-MM-DD`.

Note: CLI `collect` covers Jenkins, GitLab, local parsers, and Docker/HTTP. **GitHub and service monitors** are collected in **web mode** background collect.

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

Reads `web.host`, `web.port`, and `web.live_reload` from Settings.

Default URL: `http://127.0.0.1:8020`

### Start via Uvicorn directly (dev workflow)

```bash
py -m uvicorn web.app:app --host 0.0.0.0 --port 8020 --reload
```

### Live reload caveat

If the browser keeps loading while `web.live_reload: true`, disable it in Settings. Uvicorn reload restarts workers when files under `web/` change; rapid IDE saves can interrupt SSE connections.

### LIVE mode

When LIVE is enabled in the dashboard toolbar:

- UI polls fresh data every `web.live_dashboard_poll_seconds` (default 20s)
- Background full collect runs at most every `web.live_collect_interval_seconds` (default 90s)

## Using the UI

### Pages

| Path | Description |
|---|---|
| `/` | Main dashboard (tabs below) |
| `/settings` | Settings editor with connection tests |

### Dashboard tabs

| Tab | Content |
|---|---|
| Overview | Summary cards, favorites, recent builds/tests/services |
| Builds | Jenkins/GitLab/GitHub pipelines with filters |
| Test failures | Top failures, grouped views |
| Test runs | All test records |
| Services | Docker, HTTP, external monitors |
| System | Host CPU/RAM/disk (when procfs available) |
| Trends | Charts + KPI cards (recovery time, crash frequency) |
| Incidents | Service incidents from log intelligence |
| Log intel | Container log models, anomaly training, correlation |
| HAR | Upload and analyze HAR network traces |

### Collect panel

- View last collect status, logs, and slow steps
- Trigger manual collect or stop a running collect (token if configured)
- Toggle auto-collect interval

### Settings workflow

1. Open `/settings`
2. Enable desired sources (Jenkins, GitLab, GitHub, monitors, Docker)
3. Use **Test connection** per source before saving
4. Save — settings persist to `monitor.db` and the collect loop restarts if needed
5. Optional: **Reset collected data** clears snapshot/history but keeps credentials

## Files under `data/`

Default location: `general.data_dir` (usually `data/`).

| File / key | Purpose |
|---|---|
| `monitor.db` | Settings (`app_config_json`), latest snapshot, event feed, trends history, build/test/service history, service incidents, log intelligence state |
| `ci_report.csv`, `ci_report.html` | CLI-generated reports (if requested) |

Legacy JSON files (`snapshot.json`, `event_feed.json`, `trends.json`) are migrated into `monitor.db` automatically on first open when the corresponding `meta` keys are empty.

## Webhook integration

```bash
curl -X POST "http://127.0.0.1:8020/webhook/build-complete" ^
  -H "Content-Type: application/json" ^
  -H "X-API-Token: YOUR_TOKEN" ^
  -d "{\"source\":\"jenkins\",\"job\":\"backend-build\",\"status\":\"failure\",\"build_number\":143,\"critical\":true}"
```

The webhook schedules a collect cycle to refresh the dashboard.

## Troubleshooting

### “401 Unauthorized” on API calls

You configured `CICD_MON_API_TOKEN` or `web.api_token` but the request lacks the token header. Add `X-API-Token` or remove the token config temporarily.

### Dashboard loads, but shows no data

- Wait for auto-collect or trigger manual collect from the UI
- Check `/api/collect/status` and collect logs for errors
- Verify CI/monitor credentials via Settings → Test connection
- Ensure `general.data_dir` points to the directory containing `monitor.db`

### Jenkins SSL errors

Set `verify_ssl: false` for that Jenkins instance (internal/self-signed only).

### Docker checks fail on Windows

- Ensure Docker Desktop is running
- For HTTP-only monitoring, disable container listing and configure only `http_checks`

### Service monitors return no data

- Confirm `service_monitors.enabled: true`
- Test each instance in Settings
- Check firewall/network from the monitor host to the target API

### Trends KPI shows “—” for recovery time

No matched fail→recover pairs in the selected period/filter. See `docs/KPI_FAQ.md`.

## Where to go next

- Developer guide: `docs/DEVELOPER_GUIDE.md`
- Filter behavior: `docs/HOW_FILTERS_WORK_END_TO_END.md`
- Operational runbook: `docs/RUNBOOK_INCIDENTS.md`
