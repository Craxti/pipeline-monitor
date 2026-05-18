# Contributing to CI/CD Monitor

## Run locally

1. Create a virtual environment and install dependencies:

   ```bash
   py -m pip install -r requirements.txt
   py -m pip install ruff
   ```

2. Copy or edit `config.yaml` for your Jenkins/GitLab instances and tokens.

3. Collect a snapshot (optional, for full dashboard data):

   ```bash
   py ci_monitor.py collect
   ```

4. Start the web UI:

   ```bash
   py -m uvicorn web.app:app --host 0.0.0.0 --port 8080 --reload
   ```

   Open `http://localhost:8080/`. Static assets are served from `web/static/` at `/static/…`.

## Layout

- **`web/app.py`** — FastAPI application: most REST handlers, HTML pages, collect loop, chat, exports.
- **`web/routes/`** — Routers mounted on the app (`ops`, `incident`; other modules are stubs until handlers move out of `app.py`).
- **`web/services/`** — Pure logic (`incident_bundle` builds typed JSON + Markdown; `aggregation` / `exports` are stubs for the next extraction step).
- **`web/schemas.py`** — Pydantic: `/health`, `/ready`, `general` config slice, incident bundle payload.
- **`web/db.py`** — Optional SQLite persistence for events / analytics.
- **`web/static/app.css`** — Entry stylesheet (`@import` of `dashboard.css`).
- **`web/static/app.js`** — Thin marker script; behaviour lives in **`dashboard.js`**.
- **`web/static/dashboard.js`** — Dashboard UI (tabs, tables, filters, modals). Prefer `data-dash-action` + delegated handlers over inline `onclick` in templates.
- **`web/static/dashboard.css`** — Dashboard styles.
- **`web/templates/index.html`** — Dashboard markup only.
- **`web/templates/partials/i18n_core.html`** — UI strings (EN/RU).

## Lint / format

Use a single entry point (GNU Make):

```bash
make lint
```

This runs **Ruff** (check + format check) and **Black** on `web/routes`, `web/services`, and `web/schemas.py`. To auto-fix:

```bash
make lint-fix
```

On Windows without `make`, run the same checks directly:

```bash
py -m ruff check .
py -m ruff format --check .
py -m black --check web/routes web/services web/schemas.py
```

## Naming

The product name in UI and docs should be **CI/CD Monitor** (no variants).
