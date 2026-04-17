"""Incident export routes (JSON / Markdown / browser HTML)."""

from __future__ import annotations

import html
import json
import logging
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, PlainTextResponse, Response

from web.services.incident_bundle import build_incident_bundle

logger = logging.getLogger(__name__)

router = APIRouter(tags=["incident"])


def _incident_accepts_browser_html(request: Request) -> bool:
    if request.query_params.get("raw") == "1":
        return False
    accept = (request.headers.get("accept") or "*/*").strip()
    if not accept:
        return False
    first = accept.split(",")[0].strip().split(";")[0].strip().lower()
    return first == "text/html"


def _incident_tab_hrefs(request: Request) -> tuple[str, str]:
    p = request.url.path
    if "/export/" in p:
        return "/api/export/incident/json", "/api/export/incident/md"
    return "/api/incident.json", "/api/incident.md"


def _markdown_to_html(md_text: str) -> str:
    try:
        import markdown as md_pkg

        return md_pkg.markdown(
            md_text,
            extensions=["extra", "nl2br", "sane_lists"],
        )
    except Exception as exc:
        logger.debug("Incident markdown render fallback: %s", exc)
        return f"<pre>{html.escape(md_text)}</pre>"


def _incident_browser_page(
    *,
    request: Request,
    title: str,
    active: str,
    main_html: str,
) -> str:
    json_href, md_href = _incident_tab_hrefs(request)
    raw_href = f"{request.url.path}?raw=1"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/png" href="/static/logo-mark.png?v=20260417i" sizes="32x32">
<title>{html.escape(title)}</title>
<style>
:root {{
  --bg: #0d1117;
  --surface: #161b22;
  --fg: #e6edf3;
  --muted: #8b949e;
  --accent: #58a6ff;
  --border: #30363d;
  --ok: #3fb950;
}}
* {{ box-sizing: border-box; }}
body {{
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  background: var(--bg);
  color: var(--fg);
  margin: 0;
  min-height: 100vh;
}}
header {{
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.85rem 1.35rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}}
header h1 {{
  font-size: 1.05rem;
  font-weight: 600;
  margin: 0;
  letter-spacing: 0.02em;
}}
nav.tabs {{
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: center;
}}
nav.tabs a {{
  color: var(--muted);
  text-decoration: none;
  font-size: 0.82rem;
  padding: 0.35rem 0.65rem;
  border-radius: 6px;
  border: 1px solid transparent;
}}
nav.tabs a:hover {{ color: var(--fg); background: rgba(255,255,255,.06); }}
nav.tabs a.active {{
  border-color: var(--border);
  background: rgba(88, 166, 255, 0.12);
  color: var(--accent);
}}
nav.tabs a.raw {{ color: var(--ok); }}
main {{ max-width: 56rem; margin: 0 auto; }}
pre.json {{
  margin: 0;
  padding: 1.25rem 1.35rem 2rem;
  overflow: auto;
  font-size: 13px;
  line-height: 1.55;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-word;
}}
.prose {{
  padding: 1.25rem 1.35rem 2.5rem;
  line-height: 1.6;
  font-size: 0.95rem;
}}
.prose h1 {{ font-size: 1.45rem; margin: 0 0 1rem; font-weight: 650; }}
.prose h2 {{ font-size: 1.1rem; margin: 1.5rem 0 0.65rem; color: var(--fg); }}
.prose p {{ margin: 0.5rem 0; color: var(--muted); }}
.prose ul {{ margin: 0.4rem 0; padding-left: 1.35rem; }}
.prose li {{ margin: 0.25rem 0; }}
.prose code {{
  background: rgba(255,255,255,.08);
  padding: 0.12em 0.4em;
  border-radius: 4px;
  font-size: 0.9em;
}}
.prose a {{ color: var(--accent); }}
.prose strong {{ color: var(--fg); }}
</style>
</head>
<body>
<header>
  <h1>{html.escape(title)}</h1>
  <nav class="tabs" aria-label="Incident views">
    <a href="{html.escape(json_href)}" class="{'active' if active == 'json' else ''}">JSON</a>
    <a href="{html.escape(md_href)}" class="{'active' if active == 'md' else ''}">Markdown</a>
    <a href="{html.escape(raw_href)}" class="raw">Raw</a>
    <a href="/">Dashboard</a>
  </nav>
</header>
<main>
{main_html}
</main>
</body>
</html>"""


async def _export_incident_response(fmt: str, request: Optional[Request] = None) -> Response:
    from web.app import _load_snapshot

    snap = _load_snapshot()
    payload, md_text = build_incident_bundle(snap)
    fl = fmt.lower()
    is_md = fl in ("md", "markdown")

    if request is not None and _incident_accepts_browser_html(request):
        if is_md:
            body = f'<article class="prose">{_markdown_to_html(md_text)}</article>'
            page = _incident_browser_page(
                request=request,
                title="Incident — CI/CD Monitor",
                active="md",
                main_html=body,
            )
            return HTMLResponse(page)
        pretty = json.dumps(payload.model_dump(mode="json"), indent=2, ensure_ascii=False)
        body = f'<pre class="json">{html.escape(pretty)}</pre>'
        page = _incident_browser_page(
            request=request,
            title="Incident (JSON) — CI/CD Monitor",
            active="json",
            main_html=body,
        )
        return HTMLResponse(page)

    if is_md:
        return PlainTextResponse(md_text, media_type="text/markdown; charset=utf-8")
    raw_json = json.dumps(payload.model_dump(mode="json"), indent=2, ensure_ascii=False)
    return Response(
        content=raw_json.encode("utf-8"),
        media_type="application/json; charset=utf-8",
    )


@router.get("/api/export/incident.md")
async def export_incident_md_path(request: Request):
    return await _export_incident_response("md", request)


@router.get("/api/export/incident.json")
async def export_incident_json_path(request: Request):
    return await _export_incident_response("json", request)


@router.get("/api/export/incident/json")
async def export_incident_json_segment(request: Request):
    return await _export_incident_response("json", request)


@router.get("/api/export/incident/md")
async def export_incident_md_segment(request: Request):
    return await _export_incident_response("md", request)


@router.get("/api/incident.json")
async def export_incident_json_flat(request: Request):
    return await _export_incident_response("json", request)


@router.get("/api/incident.md")
async def export_incident_md_flat(request: Request):
    return await _export_incident_response("md", request)


@router.get("/api/incident")
async def export_incident_short(request: Request, fmt: str = "json"):
    return await _export_incident_response(fmt, request)


@router.get("/api/export/incident")
async def export_incident(request: Request, fmt: str = "json"):
    return await _export_incident_response(fmt, request)
