# CI/CD Monitor — Issues & Pull Requests workflow

This document defines how we file issues and propose changes. It aligns with the current repo (CLI + FastAPI dashboard, SQLite-backed settings in `monitor.db`, Ruff/Black linting).

## Repository links

- **Source**: `https://github.com/Craxti/pipeline-monitor`
- **License**: MIT (2026), see `LICENSE`

## Issues

Use GitHub Issues to track:

- bugs (incorrect data, crashes, wrong UI state)
- feature requests (new sources, monitors, analytics, exports)
- questions/support (setup, configuration, runtime behavior)

### Before creating an issue

- Check `README.md`, `docs/USER_GUIDE.md`, and `docs/DEVELOPER_GUIDE.md`
- Make sure you are running the latest code from `main`
- Sanitize secrets (tokens/passwords) before sharing logs or config exports

### What to include (bugs)

- minimal reproduction steps
- expected vs actual behavior
- environment (OS, Python version, Docker vs local, run mode)
- relevant logs (redacted)
- optional: sanitized snapshot from `/api/status` or `monitor.db` export

## Pull requests

GitHub PRs; template at `.github/PULL_REQUEST_TEMPLATE.md`.

### PR expectations

- Keep PRs focused (one topic/feature/bugfix).
- Update docs when behavior changes:
  - `README.md`
  - `docs/USER_GUIDE.md`
  - `docs/DEVELOPER_GUIDE.md`
  - supporting docs (`HOW_FILTERS`, `RUNBOOK`, `KPI_FAQ`) when affected
- Do not commit secrets or local artifacts (tokens, `data/monitor.db`, `__pycache__`).

### Recommended test checklist

```bash
py -m pytest -q
```

Lint/format:

```bash
make lint
```

Windows without `make`:

```bash
py -m ruff check .
py -m ruff format --check .
py -m black --check web/routes web/services web/schemas.py
```

Smoke run (UI/API changes):

```bash
py ci_monitor.py web
# open http://127.0.0.1:8020
```

### What reviewers look for

- correctness and resilience to partial/missing config
- safe handling of secrets (masking/merging for settings)
- no regressions in shared token auth behavior
- service monitor / collect_sync wiring when adding integrations
- minimal, readable diffs and clear PR description
