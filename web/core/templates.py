"""Jinja2 templates factory for the web UI."""

from __future__ import annotations

from pathlib import Path

from fastapi.templating import Jinja2Templates


def create_templates() -> Jinja2Templates:
    """Create Jinja2 templates instance for the `web/templates` directory."""
    base_dir = Path(__file__).resolve().parents[1]
    return Jinja2Templates(directory=str(base_dir / "templates"))
