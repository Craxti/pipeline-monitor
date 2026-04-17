"""Remove @app.* decorators for handlers moved to web/routes/* (implementations stay in web.app)."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "web" / "app.py"

LINES_TO_REMOVE = {
    '@app.get("/api/builds", response_class=JSONResponse)',
    '@app.get("/api/instances", response_class=JSONResponse)',
    '@app.get("/api/builds/history", response_class=JSONResponse)',
    '@app.get("/api/instances/health", response_class=JSONResponse)',
    '@app.get("/api/tests", response_class=JSONResponse)',
    '@app.get("/api/tests/top-failures", response_class=JSONResponse)',
    '@app.get("/api/services", response_class=JSONResponse)',
    '@app.get("/api/export/builds")',
    '@app.get("/api/export/tests")',
    '@app.get("/api/export/failures")',
    '@app.get("/api/collect/status", response_class=JSONResponse)',
    (
        '@app.post("/api/collect/auto", response_class=JSONResponse, '
        "dependencies=[Depends(require_shared_token)])"
    ),
    '@app.get("/api/collect/logs", response_class=JSONResponse)',
    '@app.get("/api/collect/slow", response_class=JSONResponse)',
    (
        '@app.post("/api/collect", response_class=JSONResponse, '
        "dependencies=[Depends(require_shared_token)])"
    ),
    (
        '@app.get("/api/settings", response_class=JSONResponse, '
        "dependencies=[Depends(require_shared_token)])"
    ),
    '@app.get("/api/settings/public", response_class=JSONResponse)',
    (
        '@app.post("/api/settings", response_class=JSONResponse, '
        "dependencies=[Depends(require_shared_token)])"
    ),
    '@app.get("/settings", response_class=HTMLResponse)',
    '@app.post("/api/chat", dependencies=[Depends(require_shared_token)])',
    (
        '@app.get("/api/chat/status", response_class=JSONResponse, '
        "dependencies=[Depends(require_shared_token)])"
    ),
    (
        '@app.get("/api/chat/proxy-check", response_class=JSONResponse, '
        "dependencies=[Depends(require_shared_token)])"
    ),
    (
        '@app.get("/api/proxy-check", response_class=JSONResponse, '
        "dependencies=[Depends(require_shared_token)])"
    ),
}


def main() -> None:
    """Remove moved `@app.*` decorators from `web/app.py`."""
    text = APP.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped in LINES_TO_REMOVE:
            continue
        out.append(line)
    # Remove early include_router block for ops/incident (re-added at EOF)
    joined = "".join(out)
    block = (
        "from web.routes.incident import router as _incident_router\n"
        "from web.routes.ops import router as _ops_router\n\n"
        "app.include_router(_ops_router)\n"
        "app.include_router(_incident_router)\n"
    )
    if block in joined:
        joined = joined.replace(block, "\n", 1)
    marker = "# ── Dashboard HTML ────────────────────────────────────────────────────────\n"
    insert = (
        "\n"
        "from web.routes.builds import router as _builds_router\n"
        "from web.routes.chat import router as _chat_router\n"
        "from web.routes.collect import router as _collect_router\n"
        "from web.routes.incident import router as _incident_router\n"
        "from web.routes.ops import router as _ops_router\n"
        "from web.routes.services import router as _services_router\n"
        "from web.routes.settings import router as _settings_router\n"
        "from web.routes.tests import router as _tests_router\n"
        "\n"
        "for __r in (\n"
        "    _ops_router,\n"
        "    _incident_router,\n"
        "    _collect_router,\n"
        "    _builds_router,\n"
        "    _tests_router,\n"
        "    _services_router,\n"
        "    _settings_router,\n"
        "    _chat_router,\n"
        "):\n"
        "    app.include_router(__r)\n\n"
    )
    if marker not in joined:
        raise SystemExit("marker not found for router insert")
    joined = joined.replace(marker, insert + marker, 1)
    APP.write_text(joined, encoding="utf-8")
    print("patched", APP)


if __name__ == "__main__":
    main()
