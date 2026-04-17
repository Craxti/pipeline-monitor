# CI/CD Monitor — Issues & Pull Requests workflow

This document defines how we file issues and propose changes. It is intentionally aligned with how this repo works today (CLI + FastAPI dashboard, YAML config, JSON/SQLite data artifacts, Ruff/Black linting).

## Repository links

- **Source**: `https://github.com/Craxti/pipeline-monitor`
- **License**: MIT (2026), see `LICENSE`

## Issues

Use GitHub Issues to track:

- bugs (incorrect data, crashes, wrong UI state)
- feature requests (new sources, analytics, exports)
- questions/support (setup, configuration, runtime behavior)

### Before creating an issue

- Check `README.md`, `docs/USER_GUIDE.md`, and `docs/DEVELOPER_GUIDE.md`
- Make sure you are running the latest code from `main`
- Sanitize secrets (tokens/passwords) before sharing logs/config

### What to include (bugs)

- minimal reproduction steps
- expected vs actual behavior
- environment (OS, Python version, run mode)
- relevant logs (redacted)
- optional: sanitized `data/snapshot.json`

## Pull requests (merge requests)

This repo uses GitHub PRs. The PR template is stored at `.github/PULL_REQUEST_TEMPLATE.md`.

### PR expectations

- Keep PRs focused (one topic/feature/bugfix).
- Update docs when behavior changes:
  - `README.md`
  - `docs/USER_GUIDE.md`
  - `docs/DEVELOPER_GUIDE.md`
- Do not commit secrets or local artifacts (tokens, `.db`, large `data/*.json`).

### Recommended test checklist

Run at least:

```bash
py -m pytest -q
```

Lint/format:

```bash
make lint
```

If you do not have `make` on Windows:

```bash
py -m ruff check .
py -m ruff format --check .
py -m black --check web/routes web/services web/schemas.py
```

Smoke run (optional but helpful for UI/API changes):

```bash
py ci_monitor.py collect
py ci_monitor.py web
```

### What reviewers look for

- correctness and resilience to partial/missing config
- safe handling of secrets (masking/merging for settings)
- no regressions in shared token auth behavior
- minimal, readable diffs and clear PR description

