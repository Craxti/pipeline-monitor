from __future__ import annotations

from pathlib import Path

from fastapi.templating import Jinja2Templates


def create_templates(*, base_dir: Path) -> Jinja2Templates:
    templates_dir = base_dir / "templates"
    return Jinja2Templates(directory=str(templates_dir))

